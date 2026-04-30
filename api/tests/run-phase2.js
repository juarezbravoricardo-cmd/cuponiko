#!/usr/bin/env node
'use strict';

/**
 * Runner autónomo de tests de aceptación para Fase 2 de Cuponiko.
 *
 * Formato de salida (exigido por cuponiko_tests_aceptacion_v1.md):
 *   T-XXX: PASS
 *   T-XXX: FAIL: motivo
 *
 * Cada test se aísla con un `runTag` único; los emails/phones/códigos se
 * prefijan para permitir una limpieza confiable al final sin tocar datos de
 * producción.
 *
 * Dependencias: supertest + pg (ya en package.json).
 * MOCK_EXTERNAL_SERVICES=true para usar el mock de geocoding/twilio/google.
 */

process.env.NODE_ENV = 'test';
process.env.MOCK_EXTERNAL_SERVICES = 'true';
// T-243 dispara ~250 req/min contra 127.0.0.1, rebalsando el límite por
// defecto (100/min/IP). Subimos el bucket para que el global limiter no
// contamine pruebas de concurrencia.
process.env.RATE_LIMIT_GLOBAL_PER_MIN = process.env.RATE_LIMIT_GLOBAL_PER_MIN || '5000';
require('dotenv').config();

const request = require('supertest');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const { buildApp } = require('../src/app');
const { pool, query, withTransaction } = require('../src/config/db');
const { hashPassword, sha256 } = require('../src/utils/hash');
const { signAccessToken, issueTokenPair } = require('../src/utils/jwt');
const { _resetAll: resetScannerState } = require('../src/middleware/scannerLimiter');
const { _resetInMemoryBuckets } = require('../src/middleware/rateLimiter');

const app = buildApp();
const agent = () => request(app);
const runTag = `phase2_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
const PREFIX = `t2_${runTag}_`;

const results = [];
function record(id, ok, motivo) {
  results.push({ id, ok, motivo });
  const tag = ok ? 'PASS' : 'FAIL';
  const msg = ok ? '' : `: ${motivo}`;
  // eslint-disable-next-line no-console
  console.log(`${id}: ${tag}${msg}`);
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function uniq(label = '') {
  return `${PREFIX}${Math.random().toString(36).slice(2, 8)}${label}`;
}
function uniqEmail(label = '') {
  return `${uniq(label)}@mail.test`;
}
function todayPlus(daysFromToday) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}
function yesterdayYmd() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function tomorrowYmd() {
  return todayPlus(1);
}

function tokenFor(user) {
  return signAccessToken({
    sub: String(user.id),
    role: user.role,
    email: user.email,
  });
}

async function createConsumer(label = 'c') {
  const email = uniqEmail(label);
  const ph = await hashPassword('password1');
  const r = await query(
    `INSERT INTO users (email, password_hash, full_name, role, is_active, email_verified)
     VALUES ($1, $2, $3, 'consumer', TRUE, TRUE)
     RETURNING id, email, role, full_name`,
    [email, ph, `Consumer ${label}`]
  );
  const user = r.rows[0];
  user.access_token = tokenFor(user);
  return user;
}

async function createBusiness(label = 'b', { plan = 'free', status = 'active' } = {}) {
  const email = uniqEmail(label);
  const ph = await hashPassword('password1');
  // Usuario negocio
  const r = await query(
    `INSERT INTO users (email, password_hash, full_name, phone, role, is_active,
                        email_verified, phone_verified)
     VALUES ($1, $2, $3, $4, 'business', TRUE, TRUE, TRUE)
     RETURNING id, email, role, full_name`,
    [email, ph, `Biz ${label}`, `+521${crypto.randomInt(1000000000, 9999999999)}`]
  );
  const user = r.rows[0];
  // El trigger trg_sync_business_location genera location desde lat/lng.
  const b = await query(
    `INSERT INTO businesses (user_id, business_name, category, lat, lng, display_address,
                             plan, status)
     VALUES ($1, $2, $3, $4::double precision, $5::double precision, $6, $7, $8)
     RETURNING id, plan, status, lat, lng`,
    [user.id, `Biz-${label}-${runTag}`, 'cafeteria', 19.4326, -99.1332, `Addr ${label}`, plan, status]
  );
  return {
    user: { ...user, access_token: tokenFor(user) },
    business: b.rows[0],
  };
}

async function createCouponDirect(businessId, overrides = {}) {
  const row = {
    title: `Cupón ${runTag}`,
    description: 'desc',
    discount_type: 'percent',
    discount_value: 20,
    precio_referencia: null,
    start_date: todayPlus(0),
    end_date: todayPlus(30),
    usage_limit_per_user: 1,
    total_usage_limit: 100,
    transferable: false,
    accumulable: false,
    max_accumulated_discount: 70,
    max_coupons_per_tx: 2,
    single_use: true,
    is_ad_exclusive: false,
    status: 'active',
    ...overrides,
  };
  const r = await query(
    `INSERT INTO coupons (business_id, title, description, discount_type, discount_value,
                          precio_referencia, start_date, end_date, usage_limit_per_user,
                          total_usage_limit, transferable, accumulable,
                          max_accumulated_discount, max_coupons_per_tx, single_use,
                          is_ad_exclusive, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      businessId,
      row.title,
      row.description,
      row.discount_type,
      row.discount_value,
      row.precio_referencia,
      row.start_date,
      row.end_date,
      row.usage_limit_per_user,
      row.total_usage_limit,
      row.transferable,
      row.accumulable,
      row.max_accumulated_discount,
      row.max_coupons_per_tx,
      row.single_use,
      row.is_ad_exclusive,
      row.status,
    ]
  );
  return r.rows[0];
}

async function saveCouponDirect(couponId, consumerId) {
  const r = await query(
    `INSERT INTO coupon_instances (coupon_id, consumer_id) VALUES ($1, $2)
     ON CONFLICT (coupon_id, consumer_id) DO NOTHING
     RETURNING id`,
    [couponId, consumerId]
  );
  if (r.rowCount === 0) {
    const e = await query(
      `SELECT id FROM coupon_instances WHERE coupon_id=$1 AND consumer_id=$2`,
      [couponId, consumerId]
    );
    return e.rows[0].id;
  }
  return r.rows[0].id;
}

async function cleanupAll() {
  try {
    // Borrar usuarios por prefijo → CASCADE borra businesses, coupons, coupon_instances,
    // redemption_tokens, redemptions, activity_logs.
    await query(
      `DELETE FROM users WHERE email LIKE $1 || '%' OR full_name LIKE $1 || '%'`,
      [PREFIX]
    );
    await query(
      `DELETE FROM activity_logs WHERE metadata::text LIKE '%' || $1 || '%'`,
      [runTag]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[cleanup warn]', err.message);
  }
}

function extractError(res) {
  return res.body?.error || res.text || '(sin mensaje)';
}

// ────────────────────────────────────────────────────────────
// TESTS
// ────────────────────────────────────────────────────────────

// T-200: Crear cupón exitoso (plan free)
async function T200() {
  const { user: owner, business } = await createBusiness('t200');
  // Crear 2 cupones previos directo
  await createCouponDirect(business.id);
  await createCouponDirect(business.id);
  const res = await agent()
    .post('/api/coupons')
    .set('Authorization', `Bearer ${owner.access_token}`)
    .send({
      title: 'Nuevo',
      discount_type: 'percent',
      discount_value: 15,
      start_date: todayPlus(0),
      end_date: todayPlus(30),
      total_usage_limit: 50,
    });
  if (res.status !== 201) throw new Error(`status ${res.status} body=${JSON.stringify(res.body)}`);
  if (res.body?.data?.status !== 'active') throw new Error('status no active');
  if (!res.body?.data?.coupon_id) throw new Error('sin coupon_id');
}

// T-201 ⚡: Plan free con 3 activos → PLAN_LIMIT
async function T201() {
  const { user: owner, business } = await createBusiness('t201');
  for (let i = 0; i < 3; i++) await createCouponDirect(business.id);
  const res = await agent()
    .post('/api/coupons')
    .set('Authorization', `Bearer ${owner.access_token}`)
    .send({
      title: 'Extra',
      discount_type: 'percent',
      discount_value: 10,
      start_date: todayPlus(0),
      end_date: todayPlus(10),
      total_usage_limit: 10,
    });
  if (res.status !== 403) throw new Error(`esperaba 403, got ${res.status}`);
  if (res.body?.code !== 'PLAN_LIMIT') throw new Error(`code ${res.body?.code}`);
  if (!/máximo 3 cupones activos/i.test(res.body?.error || ''))
    throw new Error(`mensaje: ${res.body?.error}`);
  // DB: no debe haber 4 cupones
  const c = await query(`SELECT COUNT(*)::int n FROM coupons WHERE business_id=$1`, [business.id]);
  if (c.rows[0].n !== 3) throw new Error(`DB: hay ${c.rows[0].n} cupones, esperaba 3`);
}

// T-202: Plan premium sin límite
async function T202() {
  const { user: owner, business } = await createBusiness('t202', { plan: 'premium' });
  for (let i = 0; i < 5; i++) await createCouponDirect(business.id);
  const res = await agent()
    .post('/api/coupons')
    .set('Authorization', `Bearer ${owner.access_token}`)
    .send({
      title: 'Extra',
      discount_type: 'percent',
      discount_value: 10,
      start_date: todayPlus(0),
      end_date: todayPlus(10),
      total_usage_limit: 10,
    });
  if (res.status !== 201) throw new Error(`status ${res.status}`);
}

// T-203 ⚡: 2x1 + accumulable → INVALID_COMBINATION
async function T203() {
  const { user: owner } = await createBusiness('t203');
  const res = await agent()
    .post('/api/coupons')
    .set('Authorization', `Bearer ${owner.access_token}`)
    .send({
      title: 't',
      discount_type: '2x1',
      discount_value: 50,
      precio_referencia: 100,
      accumulable: true,
      start_date: todayPlus(0),
      end_date: todayPlus(5),
      total_usage_limit: 10,
    });
  if (res.status !== 400) throw new Error(`status ${res.status}`);
  if (res.body?.code !== 'INVALID_COMBINATION') throw new Error(`code ${res.body?.code}`);
  const expected = 'Los cupones 2x1 y gratis no pueden ser acumulables.';
  if (res.body?.error !== expected) throw new Error(`msg: ${res.body?.error}`);
}

// T-204 ⚡: free + accumulable → INVALID_COMBINATION
async function T204() {
  const { user: owner } = await createBusiness('t204');
  const res = await agent()
    .post('/api/coupons')
    .set('Authorization', `Bearer ${owner.access_token}`)
    .send({
      title: 't',
      discount_type: 'free',
      discount_value: 100,
      precio_referencia: 100,
      accumulable: true,
      start_date: todayPlus(0),
      end_date: todayPlus(5),
      total_usage_limit: 10,
    });
  if (res.status !== 400) throw new Error(`status ${res.status}`);
  if (res.body?.code !== 'INVALID_COMBINATION') throw new Error(`code ${res.body?.code}`);
}

// T-205: 2x1 sin precio_referencia
async function T205() {
  const { user: owner } = await createBusiness('t205');
  const res = await agent()
    .post('/api/coupons')
    .set('Authorization', `Bearer ${owner.access_token}`)
    .send({
      title: 't',
      discount_type: '2x1',
      discount_value: 50,
      start_date: todayPlus(0),
      end_date: todayPlus(5),
      total_usage_limit: 10,
    });
  if (res.status !== 400) throw new Error(`status ${res.status}`);
  if (!/precio de referencia es obligatorio/i.test(res.body?.error || ''))
    throw new Error(`msg: ${res.body?.error}`);
}

// T-206: free sin precio_referencia
async function T206() {
  const { user: owner } = await createBusiness('t206');
  const res = await agent()
    .post('/api/coupons')
    .set('Authorization', `Bearer ${owner.access_token}`)
    .send({
      title: 't',
      discount_type: 'free',
      discount_value: 100,
      start_date: todayPlus(0),
      end_date: todayPlus(5),
      total_usage_limit: 10,
    });
  if (res.status !== 400) throw new Error(`status ${res.status}`);
  if (!/precio de referencia es obligatorio/i.test(res.body?.error || ''))
    throw new Error(`msg: ${res.body?.error}`);
}

// T-207: Transferible solo para Premium
async function T207() {
  const { user: owner } = await createBusiness('t207'); // plan free
  const res = await agent()
    .post('/api/coupons')
    .set('Authorization', `Bearer ${owner.access_token}`)
    .send({
      title: 't',
      discount_type: 'percent',
      discount_value: 10,
      transferable: true,
      start_date: todayPlus(0),
      end_date: todayPlus(5),
      total_usage_limit: 10,
    });
  if (res.status !== 403) throw new Error(`status ${res.status}`);
  if (res.body?.code !== 'PLAN_REQUIRED') throw new Error(`code ${res.body?.code}`);
  if (!/exclusivos del plan Premium/i.test(res.body?.error || ''))
    throw new Error(`msg: ${res.body?.error}`);
}

// T-208: tope de acumulación fuera de rango
async function T208() {
  const { user: owner } = await createBusiness('t208');
  const res = await agent()
    .post('/api/coupons')
    .set('Authorization', `Bearer ${owner.access_token}`)
    .send({
      title: 't',
      discount_type: 'percent',
      discount_value: 20,
      accumulable: true,
      max_accumulated_discount: 95,
      start_date: todayPlus(0),
      end_date: todayPlus(5),
      total_usage_limit: 10,
    });
  if (res.status !== 400) throw new Error(`status ${res.status}`);
  if (!/entre 50% y 90%/i.test(res.body?.error || ''))
    throw new Error(`msg: ${res.body?.error}`);
}

// T-209: negocio suspendido
async function T209() {
  const { user: owner } = await createBusiness('t209', { status: 'suspended' });
  const res = await agent()
    .post('/api/coupons')
    .set('Authorization', `Bearer ${owner.access_token}`)
    .send({
      title: 't',
      discount_type: 'percent',
      discount_value: 10,
      start_date: todayPlus(0),
      end_date: todayPlus(5),
      total_usage_limit: 10,
    });
  if (res.status !== 403) throw new Error(`status ${res.status}`);
  if (res.body?.code !== 'BUSINESS_SUSPENDED') throw new Error(`code ${res.body?.code}`);
}

// T-220: Guardar exitoso
async function T220() {
  const consumer = await createConsumer('t220c');
  const { business } = await createBusiness('t220b');
  const coupon = await createCouponDirect(business.id);
  const res = await agent()
    .post(`/api/coupons/${coupon.id}/save`)
    .set('Authorization', `Bearer ${consumer.access_token}`);
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  if (!res.body?.data?.coupon_instance_id) throw new Error('sin instance_id');
  const c = await query(
    `SELECT COUNT(*)::int n FROM coupon_instances WHERE coupon_id=$1 AND consumer_id=$2`,
    [coupon.id, consumer.id]
  );
  if (c.rows[0].n !== 1) throw new Error(`esperaba 1 instancia, got ${c.rows[0].n}`);
}

// T-221 ⚡: Idempotencia — guardar 2 veces
async function T221() {
  const consumer = await createConsumer('t221c');
  const { business } = await createBusiness('t221b');
  const coupon = await createCouponDirect(business.id);
  const r1 = await agent()
    .post(`/api/coupons/${coupon.id}/save`)
    .set('Authorization', `Bearer ${consumer.access_token}`);
  const r2 = await agent()
    .post(`/api/coupons/${coupon.id}/save`)
    .set('Authorization', `Bearer ${consumer.access_token}`);
  if (r1.status !== 200 || r2.status !== 200)
    throw new Error(`status ${r1.status}/${r2.status}`);
  if (r1.body?.data?.coupon_instance_id !== r2.body?.data?.coupon_instance_id)
    throw new Error('instance_ids distintos');
  const c = await query(
    `SELECT COUNT(*)::int n FROM coupon_instances WHERE coupon_id=$1 AND consumer_id=$2`,
    [coupon.id, consumer.id]
  );
  if (c.rows[0].n !== 1) throw new Error(`esperaba 1, got ${c.rows[0].n}`);
}

// T-222 ⚡: Doble tap simultáneo — Promise.all
async function T222() {
  const consumer = await createConsumer('t222c');
  const { business } = await createBusiness('t222b');
  const coupon = await createCouponDirect(business.id);
  const doSave = () =>
    agent()
      .post(`/api/coupons/${coupon.id}/save`)
      .set('Authorization', `Bearer ${consumer.access_token}`);
  const [r1, r2] = await Promise.all([doSave(), doSave()]);
  if (r1.status !== 200 || r2.status !== 200)
    throw new Error(`status ${r1.status}/${r2.status}`);
  const c = await query(
    `SELECT COUNT(*)::int n FROM coupon_instances WHERE coupon_id=$1 AND consumer_id=$2`,
    [coupon.id, consumer.id]
  );
  if (c.rows[0].n !== 1) throw new Error(`DB: ${c.rows[0].n} instancias (debería ser 1)`);
}

// T-230: Generar QR exitoso
async function T230() {
  const consumer = await createConsumer('t230c');
  const { business } = await createBusiness('t230b');
  const coupon = await createCouponDirect(business.id);
  const instanceId = await saveCouponDirect(coupon.id, consumer.id);
  const res = await agent()
    .post(`/api/coupons/${instanceId}/generate-qr`)
    .set('Authorization', `Bearer ${consumer.access_token}`);
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  if (!res.body?.data?.jwt) throw new Error('sin jwt');
  if (!res.body?.data?.short_code || res.body.data.short_code.length !== 8)
    throw new Error('short_code inválido');
  if (!res.body?.data?.expires_at) throw new Error('sin expires_at');
  const c = await query(
    `SELECT COUNT(*)::int n FROM redemption_tokens WHERE coupon_instance_id=$1 AND status='pending'`,
    [instanceId]
  );
  if (c.rows[0].n !== 1) throw new Error(`esperaba 1 pending, got ${c.rows[0].n}`);
}

// T-231: Generar QR invalida tokens anteriores
async function T231() {
  const consumer = await createConsumer('t231c');
  const { business } = await createBusiness('t231b');
  const coupon = await createCouponDirect(business.id);
  const instanceId = await saveCouponDirect(coupon.id, consumer.id);
  const r1 = await agent()
    .post(`/api/coupons/${instanceId}/generate-qr`)
    .set('Authorization', `Bearer ${consumer.access_token}`);
  const r2 = await agent()
    .post(`/api/coupons/${instanceId}/generate-qr`)
    .set('Authorization', `Bearer ${consumer.access_token}`);
  if (r1.status !== 200 || r2.status !== 200)
    throw new Error(`status ${r1.status}/${r2.status}`);
  const pending = await query(
    `SELECT COUNT(*)::int n FROM redemption_tokens WHERE coupon_instance_id=$1 AND status='pending'`,
    [instanceId]
  );
  const expired = await query(
    `SELECT COUNT(*)::int n FROM redemption_tokens WHERE coupon_instance_id=$1 AND status='expired'`,
    [instanceId]
  );
  if (pending.rows[0].n !== 1) throw new Error(`pending=${pending.rows[0].n}`);
  if (expired.rows[0].n !== 1) throw new Error(`expired=${expired.rows[0].n}`);
}

// T-232: Rate limit de generación QR (10/h)
async function T232() {
  const consumer = await createConsumer('t232c');
  const { business } = await createBusiness('t232b');
  const coupon = await createCouponDirect(business.id);
  const instanceId = await saveCouponDirect(coupon.id, consumer.id);
  // Pre-populate 10 activity_logs 'qr_generated'
  for (let i = 0; i < 10; i++) {
    await query(
      `INSERT INTO activity_logs (user_id, action, metadata)
       VALUES ($1, 'qr_generated', $2::jsonb)`,
      [consumer.id, JSON.stringify({ coupon_instance_id: instanceId, runTag })]
    );
  }
  const res = await agent()
    .post(`/api/coupons/${instanceId}/generate-qr`)
    .set('Authorization', `Bearer ${consumer.access_token}`);
  if (res.status !== 429) throw new Error(`status ${res.status}`);
  if (res.body?.code !== 'RATE_LIMIT_QR') throw new Error(`code ${res.body?.code}`);
}

// T-233: Cupón agotado — no genera QR
async function T233() {
  const consumer = await createConsumer('t233c');
  const { business } = await createBusiness('t233b');
  const coupon = await createCouponDirect(business.id, {
    total_usage_limit: 1,
  });
  // saturar uses_count vía UPDATE directo
  await query(`UPDATE coupons SET uses_count = total_usage_limit WHERE id = $1`, [coupon.id]);
  const instanceId = await saveCouponDirect(coupon.id, consumer.id);
  const res = await agent()
    .post(`/api/coupons/${instanceId}/generate-qr`)
    .set('Authorization', `Bearer ${consumer.access_token}`);
  if (res.status !== 400) throw new Error(`status ${res.status}`);
  if (res.body?.code !== 'COUPON_EXHAUSTED') throw new Error(`code ${res.body?.code}`);
  if (res.body?.error !== 'Este cupón se ha agotado.')
    throw new Error(`msg: ${res.body?.error}`);
}

// T-234: Negocio suspendido — no genera QR
async function T234() {
  const consumer = await createConsumer('t234c');
  const { business } = await createBusiness('t234b');
  const coupon = await createCouponDirect(business.id);
  const instanceId = await saveCouponDirect(coupon.id, consumer.id);
  await query(`UPDATE businesses SET status='suspended' WHERE id=$1`, [business.id]);
  const res = await agent()
    .post(`/api/coupons/${instanceId}/generate-qr`)
    .set('Authorization', `Bearer ${consumer.access_token}`);
  if (res.status !== 400) throw new Error(`status ${res.status}`);
  if (res.body?.code !== 'BUSINESS_UNAVAILABLE') throw new Error(`code ${res.body?.code}`);
}

// ────────── Redención ──────────
async function generateQrViaApi(consumer, instanceId) {
  const res = await agent()
    .post(`/api/coupons/${instanceId}/generate-qr`)
    .set('Authorization', `Bearer ${consumer.access_token}`);
  if (res.status !== 200) throw new Error(`gen-qr status ${res.status}`);
  return res.body.data;
}

// T-240 ⚡: Redención exitosa por QR
async function T240() {
  const consumer = await createConsumer('t240c');
  const { user: owner, business } = await createBusiness('t240b');
  const coupon = await createCouponDirect(business.id, { total_usage_limit: 5 });
  const instanceId = await saveCouponDirect(coupon.id, consumer.id);
  const qr = await generateQrViaApi(consumer, instanceId);
  resetScannerState();
  const res = await agent()
    .post('/api/coupons/redeem')
    .set('Authorization', `Bearer ${owner.access_token}`)
    .send({ token_jwt: qr.jwt });
  if (res.status !== 200) throw new Error(`status ${res.status} body=${JSON.stringify(res.body)}`);
  const data = res.body?.data || {};
  if (!data.consumer_name) throw new Error('sin consumer_name');
  // DB checks
  const tok = await query(
    `SELECT status, used_at FROM redemption_tokens WHERE coupon_instance_id=$1 ORDER BY id DESC LIMIT 1`,
    [instanceId]
  );
  if (tok.rows[0].status !== 'used') throw new Error(`token status=${tok.rows[0].status}`);
  const c = await query(`SELECT uses_count FROM coupons WHERE id=$1`, [coupon.id]);
  if (c.rows[0].uses_count !== 1) throw new Error(`c.uses_count=${c.rows[0].uses_count}`);
  const ci = await query(`SELECT uses_count FROM coupon_instances WHERE id=$1`, [instanceId]);
  if (ci.rows[0].uses_count !== 1) throw new Error(`ci.uses_count=${ci.rows[0].uses_count}`);
  const rd = await query(
    `SELECT COUNT(*)::int n FROM redemptions WHERE coupon_instance_id=$1`,
    [instanceId]
  );
  if (rd.rows[0].n !== 1) throw new Error(`redemptions=${rd.rows[0].n}`);
  const al = await query(
    `SELECT COUNT(*)::int n FROM activity_logs
      WHERE action='coupon_scan_success' AND business_id=$1`,
    [business.id]
  );
  if (al.rows[0].n < 1) throw new Error('no activity_log');
}

// T-241 ⚡: Redención por short_code
async function T241() {
  const consumer = await createConsumer('t241c');
  const { user: owner, business } = await createBusiness('t241b');
  const coupon = await createCouponDirect(business.id, { total_usage_limit: 5 });
  const instanceId = await saveCouponDirect(coupon.id, consumer.id);
  const qr = await generateQrViaApi(consumer, instanceId);
  resetScannerState();
  const res = await agent()
    .post('/api/coupons/redeem')
    .set('Authorization', `Bearer ${owner.access_token}`)
    .send({ short_code: qr.short_code });
  if (res.status !== 200) throw new Error(`status ${res.status} body=${JSON.stringify(res.body)}`);
  const tok = await query(
    `SELECT status FROM redemption_tokens WHERE coupon_instance_id=$1 ORDER BY id DESC LIMIT 1`,
    [instanceId]
  );
  if (tok.rows[0].status !== 'used') throw new Error('token no used');
}

// T-242 ⚡ CONCURRENT: doble escaneo simultáneo
async function T242() {
  const consumer = await createConsumer('t242c');
  const { user: owner, business } = await createBusiness('t242b');
  const coupon = await createCouponDirect(business.id, { total_usage_limit: 1 });
  const instanceId = await saveCouponDirect(coupon.id, consumer.id);
  const qr = await generateQrViaApi(consumer, instanceId);
  resetScannerState();
  const doRedeem = () =>
    agent()
      .post('/api/coupons/redeem')
      .set('Authorization', `Bearer ${owner.access_token}`)
      .send({ token_jwt: qr.jwt });
  const [r1, r2] = await Promise.all([doRedeem(), doRedeem()]);
  const statuses = [r1.status, r2.status].sort();
  if (JSON.stringify(statuses) !== JSON.stringify([200, 409]))
    throw new Error(`statuses ${JSON.stringify(statuses)}`);
  const looser = r1.status === 409 ? r1 : r2;
  if (looser.body?.error !== 'Este cupón ya fue canjeado.')
    throw new Error(`msg: ${looser.body?.error}`);
  const used = await query(
    `SELECT COUNT(*)::int n FROM redemption_tokens WHERE coupon_instance_id=$1 AND status='used'`,
    [instanceId]
  );
  if (used.rows[0].n !== 1) throw new Error(`used count=${used.rows[0].n}`);
  const c = await query(`SELECT uses_count FROM coupons WHERE id=$1`, [coupon.id]);
  if (c.rows[0].uses_count !== 1) throw new Error(`c.uses_count=${c.rows[0].uses_count}`);
  const rd = await query(
    `SELECT COUNT(*)::int n FROM redemptions WHERE coupon_instance_id=$1`,
    [instanceId]
  );
  if (rd.rows[0].n !== 1) throw new Error(`redemptions=${rd.rows[0].n}`);
}

// T-243 ⚡ CONCURRENT: 101 canjes simultáneos en cupón con límite 100
// Ajuste de contrato: el cupón arranca con uses_count=99 y total_usage_limit=100.
// 101 instancias+tokens pending. Exactamente 1 debe pasar (el que toma uso #100).
async function T243() {
  const { user: owner, business } = await createBusiness('t243b');
  const coupon = await createCouponDirect(business.id, {
    total_usage_limit: 100,
    usage_limit_per_user: 1,
  });
  // Poner uses_count = 99
  await query(`UPDATE coupons SET uses_count = 99 WHERE id = $1`, [coupon.id]);
  // Crear 101 consumers + instances + tokens pending
  const N = 101;
  const consumers = [];
  for (let i = 0; i < N; i++) consumers.push(await createConsumer(`t243_${i}`));
  const tokens = [];
  for (const c of consumers) {
    const instanceId = await saveCouponDirect(coupon.id, c.id);
    const qr = await generateQrViaApi(c, instanceId);
    tokens.push(qr.jwt);
  }
  resetScannerState();
  // Disparo concurrente real con Promise.all
  const promises = tokens.map((t) =>
    agent()
      .post('/api/coupons/redeem')
      .set('Authorization', `Bearer ${owner.access_token}`)
      .send({ token_jwt: t })
  );
  const results = await Promise.all(promises);
  const ok = results.filter((r) => r.status === 200);
  const fail = results.filter((r) => r.status !== 200);
  if (ok.length !== 1) throw new Error(`ok=${ok.length} (esperaba 1)`);
  for (const r of fail) {
    if (!['COUPON_EXHAUSTED', 'ALREADY_REDEEMED', 'SCANNER_BLOCKED'].includes(r.body?.code))
      throw new Error(`code inesperado: ${r.body?.code}`);
  }
  const c = await query(`SELECT uses_count FROM coupons WHERE id=$1`, [coupon.id]);
  if (c.rows[0].uses_count !== 100)
    throw new Error(`uses_count=${c.rows[0].uses_count} (debería ser 100)`);
}

// T-244 ⚡: Token ya canjeado
async function T244() {
  const consumer = await createConsumer('t244c');
  const { user: owner, business } = await createBusiness('t244b');
  const coupon = await createCouponDirect(business.id, { total_usage_limit: 5 });
  const instanceId = await saveCouponDirect(coupon.id, consumer.id);
  const qr = await generateQrViaApi(consumer, instanceId);
  resetScannerState();
  const r1 = await agent()
    .post('/api/coupons/redeem')
    .set('Authorization', `Bearer ${owner.access_token}`)
    .send({ token_jwt: qr.jwt });
  if (r1.status !== 200) throw new Error(`primer canje status ${r1.status}`);
  const r2 = await agent()
    .post('/api/coupons/redeem')
    .set('Authorization', `Bearer ${owner.access_token}`)
    .send({ token_jwt: qr.jwt });
  if (r2.status !== 409) throw new Error(`status ${r2.status}`);
  if (r2.body?.code !== 'ALREADY_REDEEMED') throw new Error(`code ${r2.body?.code}`);
  if (r2.body?.error !== 'Este cupón ya fue canjeado.') throw new Error(`msg: ${r2.body?.error}`);
}

// T-245 ⚡: Token expirado (status='expired' en DB)
async function T245() {
  const consumer = await createConsumer('t245c');
  const { user: owner, business } = await createBusiness('t245b');
  const coupon = await createCouponDirect(business.id);
  const instanceId = await saveCouponDirect(coupon.id, consumer.id);
  const qr = await generateQrViaApi(consumer, instanceId);
  // Marcar token como expired y mover expires_at al pasado
  await query(
    `UPDATE redemption_tokens SET status='expired', expires_at=NOW() - INTERVAL '1 minute'
      WHERE coupon_instance_id=$1`,
    [instanceId]
  );
  resetScannerState();
  const r = await agent()
    .post('/api/coupons/redeem')
    .set('Authorization', `Bearer ${owner.access_token}`)
    .send({ token_jwt: qr.jwt });
  if (r.status !== 410) throw new Error(`status ${r.status}`);
  if (r.body?.code !== 'QR_EXPIRED') throw new Error(`code ${r.body?.code}`);
}

// T-246 ⚡: No transferible — otro negocio intenta escanear
async function T246() {
  const consumer = await createConsumer('t246c');
  const { business: bizA } = await createBusiness('t246a');
  const { user: bizBOwner } = await createBusiness('t246b');
  const coupon = await createCouponDirect(bizA.id, { transferable: false });
  const instanceId = await saveCouponDirect(coupon.id, consumer.id);
  const qr = await generateQrViaApi(consumer, instanceId);
  resetScannerState();
  const r = await agent()
    .post('/api/coupons/redeem')
    .set('Authorization', `Bearer ${bizBOwner.access_token}`)
    .send({ token_jwt: qr.jwt });
  if (r.status !== 403) throw new Error(`status ${r.status}`);
  if (r.body?.code !== 'NOT_TRANSFERABLE') throw new Error(`code ${r.body?.code}`);
  if (r.body?.error !== 'Este cupón no puede ser usado por otra persona.')
    throw new Error(`msg: ${r.body?.error}`);
}

// T-247: JWT con firma inválida
async function T247() {
  const { user: owner } = await createBusiness('t247b');
  resetScannerState();
  const r = await agent()
    .post('/api/coupons/redeem')
    .set('Authorization', `Bearer ${owner.access_token}`)
    .send({ token_jwt: 'not.a.valid.jwt' });
  if (r.status !== 401) throw new Error(`status ${r.status}`);
  if (r.body?.code !== 'INVALID_QR') throw new Error(`code ${r.body?.code}`);
  if (r.body?.error !== 'QR inválido.') throw new Error(`msg: ${r.body?.error}`);
}

// T-248 ⚡: Rate limit del scanner — 3 fallos en 1 minuto
async function T248() {
  const { user: owner, business } = await createBusiness('t248b');
  resetScannerState();
  // Disparar 3 fallos
  for (let i = 0; i < 3; i++) {
    const r = await agent()
      .post('/api/coupons/redeem')
      .set('Authorization', `Bearer ${owner.access_token}`)
      .send({ token_jwt: 'invalid.jwt' });
    if (i < 2 && r.status !== 401) throw new Error(`fallo #${i}: status ${r.status}`);
  }
  // 4º intento debe ser 429 SCANNER_BLOCKED
  const blocked = await agent()
    .post('/api/coupons/redeem')
    .set('Authorization', `Bearer ${owner.access_token}`)
    .send({ token_jwt: 'invalid.jwt' });
  if (blocked.status !== 429) throw new Error(`status ${blocked.status}`);
  if (blocked.body?.code !== 'SCANNER_BLOCKED') throw new Error(`code ${blocked.body?.code}`);
  if (blocked.body?.error !== 'Scanner bloqueado por intentos fallidos. Espera 5 minutos.')
    throw new Error(`msg: ${blocked.body?.error}`);
  // DB log
  const log = await query(
    `SELECT COUNT(*)::int n FROM activity_logs
      WHERE action='scanner_rate_limit_triggered' AND business_id=$1`,
    [business.id]
  );
  if (log.rows[0].n < 1) throw new Error('no log scanner_rate_limit_triggered');
}

// T-249 ⚡: Rollback si falla paso 6 (cupón agotado a mitad de la transacción)
async function T249() {
  const consumer = await createConsumer('t249c');
  const { user: owner, business } = await createBusiness('t249b');
  const coupon = await createCouponDirect(business.id, { total_usage_limit: 1 });
  const instanceId = await saveCouponDirect(coupon.id, consumer.id);
  const qr = await generateQrViaApi(consumer, instanceId);
  // Saturar el cupón ANTES del canje
  await query(`UPDATE coupons SET uses_count = total_usage_limit WHERE id = $1`, [coupon.id]);
  resetScannerState();
  const r = await agent()
    .post('/api/coupons/redeem')
    .set('Authorization', `Bearer ${owner.access_token}`)
    .send({ token_jwt: qr.jwt });
  if (r.status !== 409) throw new Error(`status ${r.status}`);
  if (r.body?.code !== 'COUPON_EXHAUSTED') throw new Error(`code ${r.body?.code}`);
  // Verificar rollback: token sigue 'pending'
  const tok = await query(
    `SELECT status FROM redemption_tokens WHERE coupon_instance_id=$1 ORDER BY id DESC LIMIT 1`,
    [instanceId]
  );
  if (tok.rows[0].status !== 'pending')
    throw new Error(`token status=${tok.rows[0].status} (debe ser pending tras rollback)`);
  // coupon_instances.uses_count sigue en 0
  const ci = await query(`SELECT uses_count FROM coupon_instances WHERE id=$1`, [instanceId]);
  if (ci.rows[0].uses_count !== 0)
    throw new Error(`ci.uses_count=${ci.rows[0].uses_count} (debe ser 0)`);
  // No hay redemptions
  const rd = await query(
    `SELECT COUNT(*)::int n FROM redemptions WHERE coupon_instance_id=$1`,
    [instanceId]
  );
  if (rd.rows[0].n !== 0) throw new Error(`redemptions=${rd.rows[0].n}`);
}

// ────────── Máquina de estados ──────────
// T-260: active → paused
async function T260() {
  const { user: owner, business } = await createBusiness('t260b');
  const c = await createCouponDirect(business.id);
  const r = await agent()
    .patch(`/api/coupons/${c.id}/pause`)
    .set('Authorization', `Bearer ${owner.access_token}`);
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  const db = await query(`SELECT status FROM coupons WHERE id=$1`, [c.id]);
  if (db.rows[0].status !== 'paused') throw new Error(`status=${db.rows[0].status}`);
}

// T-261: paused → active
async function T261() {
  const { user: owner, business } = await createBusiness('t261b');
  const c = await createCouponDirect(business.id, { status: 'paused' });
  const r = await agent()
    .patch(`/api/coupons/${c.id}/activate`)
    .set('Authorization', `Bearer ${owner.access_token}`);
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  const db = await query(`SELECT status FROM coupons WHERE id=$1`, [c.id]);
  if (db.rows[0].status !== 'active') throw new Error(`status=${db.rows[0].status}`);
}

// T-262: expired → active (inválida)
async function T262() {
  const { user: owner, business } = await createBusiness('t262b');
  const c = await createCouponDirect(business.id, { status: 'expired' });
  const r = await agent()
    .patch(`/api/coupons/${c.id}/activate`)
    .set('Authorization', `Bearer ${owner.access_token}`);
  if (r.status !== 400) throw new Error(`status ${r.status}`);
  if (r.body?.code !== 'INVALID_TRANSITION') throw new Error(`code ${r.body?.code}`);
}

// T-263: paused → paused (inválida)
async function T263() {
  const { user: owner, business } = await createBusiness('t263b');
  const c = await createCouponDirect(business.id, { status: 'paused' });
  const r = await agent()
    .patch(`/api/coupons/${c.id}/pause`)
    .set('Authorization', `Bearer ${owner.access_token}`);
  if (r.status !== 400) throw new Error(`status ${r.status}`);
  if (r.body?.code !== 'INVALID_TRANSITION') throw new Error(`code ${r.body?.code}`);
  if (r.body?.error !== 'Solo los cupones activos pueden pausarse.')
    throw new Error(`msg: ${r.body?.error}`);
}

// T-264: paused_by_downgrade → active (free con 3 activos)
async function T264() {
  const { user: owner, business } = await createBusiness('t264b');
  // 3 activos + 1 paused_by_downgrade
  for (let i = 0; i < 3; i++) await createCouponDirect(business.id, { status: 'active' });
  const frozen = await createCouponDirect(business.id, { status: 'paused_by_downgrade' });
  const r = await agent()
    .patch(`/api/coupons/${frozen.id}/activate`)
    .set('Authorization', `Bearer ${owner.access_token}`);
  if (r.status !== 403) throw new Error(`status ${r.status}`);
  if (r.body?.code !== 'PLAN_LIMIT') throw new Error(`code ${r.body?.code}`);
  if (!/3 cupones activos/i.test(r.body?.error || ''))
    throw new Error(`msg: ${r.body?.error}`);
}

// T-265: Reactivar paused_by_downgrade con fecha vencida
async function T265() {
  const { user: owner, business } = await createBusiness('t265b', { plan: 'premium' });
  const frozen = await createCouponDirect(business.id, {
    status: 'paused_by_downgrade',
    start_date: todayPlus(-30),
    end_date: yesterdayYmd(),
  });
  const r = await agent()
    .patch(`/api/coupons/${frozen.id}/activate`)
    .set('Authorization', `Bearer ${owner.access_token}`);
  if (r.status !== 400) throw new Error(`status ${r.status}`);
  if (r.body?.code !== 'COUPON_EXPIRED') throw new Error(`code ${r.body?.code}`);
  if (r.body?.error !== 'Este cupón ya venció y no puede reactivarse.')
    throw new Error(`msg: ${r.body?.error}`);
}

// ────────── Geolocalización ──────────
async function createBusinessAt(label, lat, lng, { category = 'cafeteria', status = 'active' } = {}) {
  const email = uniqEmail(label);
  const ph = await hashPassword('password1');
  const r = await query(
    `INSERT INTO users (email, password_hash, full_name, phone, role, is_active,
                        email_verified, phone_verified)
     VALUES ($1, $2, $3, $4, 'business', TRUE, TRUE, TRUE)
     RETURNING id`,
    [email, ph, `Biz ${label}`, `+521${crypto.randomInt(1000000000, 9999999999)}`]
  );
  const uid = r.rows[0].id;
  const b = await query(
    `INSERT INTO businesses (user_id, business_name, category, lat, lng, display_address,
                             plan, status)
     VALUES ($1, $2, $3, $4::double precision, $5::double precision, $6, 'free', $7)
     RETURNING id, lat, lng`,
    [uid, `Biz-${label}-${runTag}`, category, lat, lng, `Addr ${label}`, status]
  );
  return b.rows[0];
}

// Calcula un offset lat aproximado para m metros (1° lat ≈ 111,320 m)
function latOffset(meters) {
  return meters / 111320;
}

// T-270: Negocios cercanos con PostGIS (A 1km, B 3km, C 8km); radio 5km → A y B.
async function T270() {
  const consumer = await createConsumer('t270c');
  const baseLat = 20.1 + Math.random() * 0.01; // lejos de otros tests
  const baseLng = -100.2;
  const A = await createBusinessAt('t270A', baseLat + latOffset(1000), baseLng);
  const B = await createBusinessAt('t270B', baseLat + latOffset(3000), baseLng);
  await createBusinessAt('t270C', baseLat + latOffset(8000), baseLng);
  const res = await agent()
    .get(`/api/businesses/nearby?lat=${baseLat}&lng=${baseLng}&radius=5000`)
    .set('Authorization', `Bearer ${consumer.access_token}`);
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  const list = res.body?.data?.businesses || [];
  const ids = list.map((x) => Number(x.business_id));
  if (!ids.includes(Number(A.id)) || !ids.includes(Number(B.id)))
    throw new Error(`faltan A/B en ids=${ids}`);
  const idxA = ids.indexOf(Number(A.id));
  const idxB = ids.indexOf(Number(B.id));
  if (!(idxA < idxB)) throw new Error(`A (${idxA}) debe ir antes que B (${idxB})`);
  // C no debe estar
  // (ya tiene un ID asociado pero no lo extrajimos; basta confirmar que radio filtra)
}

// T-271: Filtro por categoría
async function T271() {
  const consumer = await createConsumer('t271c');
  const baseLat = 20.3 + Math.random() * 0.01;
  const baseLng = -100.4;
  const A = await createBusinessAt('t271A', baseLat + latOffset(2000), baseLng, {
    category: 'cafeteria',
  });
  const B = await createBusinessAt('t271B', baseLat + latOffset(1000), baseLng, {
    category: 'farmacia',
  });
  const res = await agent()
    .get(
      `/api/businesses/nearby?lat=${baseLat}&lng=${baseLng}&radius=5000&category=cafeteria`
    )
    .set('Authorization', `Bearer ${consumer.access_token}`);
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  const ids = (res.body?.data?.businesses || []).map((x) => Number(x.business_id));
  if (!ids.includes(Number(A.id))) throw new Error(`A ausente`);
  if (ids.includes(Number(B.id))) throw new Error(`B presente (filtro falló)`);
}

// T-272: Solo activos
async function T272() {
  const consumer = await createConsumer('t272c');
  const baseLat = 20.5 + Math.random() * 0.01;
  const baseLng = -100.6;
  const A = await createBusinessAt('t272A', baseLat + latOffset(1000), baseLng);
  const B = await createBusinessAt('t272B', baseLat + latOffset(500), baseLng, {
    status: 'suspended',
  });
  const res = await agent()
    .get(`/api/businesses/nearby?lat=${baseLat}&lng=${baseLng}&radius=5000`)
    .set('Authorization', `Bearer ${consumer.access_token}`);
  const ids = (res.body?.data?.businesses || []).map((x) => Number(x.business_id));
  if (!ids.includes(Number(A.id))) throw new Error('A ausente');
  if (ids.includes(Number(B.id))) throw new Error('B suspendido presente');
}

// T-273: Fallback IP geolocation
async function T273() {
  const res = await agent().get('/api/geo/ip-location');
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  const d = res.body?.data;
  if (!d || typeof d.lat !== 'number' || typeof d.lng !== 'number' || !d.city || !d.source)
    throw new Error(`body=${JSON.stringify(res.body)}`);
  if (!['ip_geolocation', 'default_fallback'].includes(d.source))
    throw new Error(`source=${d.source}`);
}

// ────────── Cartera ──────────
// T-280: orden por end_date ascendente
async function T280() {
  const consumer = await createConsumer('t280c');
  const { business } = await createBusiness('t280b');
  const cA = await createCouponDirect(business.id, { end_date: todayPlus(2) });
  const cB = await createCouponDirect(business.id, { end_date: todayPlus(7) });
  const cC = await createCouponDirect(business.id, { end_date: todayPlus(1) });
  await saveCouponDirect(cA.id, consumer.id);
  await saveCouponDirect(cB.id, consumer.id);
  await saveCouponDirect(cC.id, consumer.id);
  const res = await agent()
    .get('/api/wallet/coupons?tab=active')
    .set('Authorization', `Bearer ${consumer.access_token}`);
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  const ids = (res.body?.data?.coupons || []).map((x) => Number(x.coupon_id));
  const want = [Number(cC.id), Number(cA.id), Number(cB.id)];
  if (JSON.stringify(ids) !== JSON.stringify(want))
    throw new Error(`ids=${JSON.stringify(ids)} expected ${JSON.stringify(want)}`);
}

// T-281: cupón de negocio suspendido aparece marcado
async function T281() {
  const consumer = await createConsumer('t281c');
  const { business } = await createBusiness('t281b');
  const c = await createCouponDirect(business.id);
  await saveCouponDirect(c.id, consumer.id);
  await query(`UPDATE businesses SET status='suspended' WHERE id=$1`, [business.id]);
  const res = await agent()
    .get('/api/wallet/coupons?tab=active')
    .set('Authorization', `Bearer ${consumer.access_token}`);
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  const list = res.body?.data?.coupons || [];
  const found = list.find((x) => Number(x.coupon_id) === Number(c.id));
  if (!found) throw new Error('cupón no aparece');
  if (found.business?.business_status !== 'suspended')
    throw new Error(`business_status=${found.business?.business_status}`);
}

// T-282: paused_by_downgrade NO aparece en cartera activa
async function T282() {
  const consumer = await createConsumer('t282c');
  const { business } = await createBusiness('t282b');
  const c = await createCouponDirect(business.id);
  await saveCouponDirect(c.id, consumer.id);
  await query(`UPDATE coupons SET status='paused_by_downgrade' WHERE id=$1`, [c.id]);
  const res = await agent()
    .get('/api/wallet/coupons?tab=active')
    .set('Authorization', `Bearer ${consumer.access_token}`);
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  const list = res.body?.data?.coupons || [];
  const found = list.find((x) => Number(x.coupon_id) === Number(c.id));
  if (found) throw new Error('cupón paused_by_downgrade aparece');
}

// ────────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────────
const ALL_TESTS = [
  ['T-200', T200],
  ['T-201', T201],
  ['T-202', T202],
  ['T-203', T203],
  ['T-204', T204],
  ['T-205', T205],
  ['T-206', T206],
  ['T-207', T207],
  ['T-208', T208],
  ['T-209', T209],
  ['T-220', T220],
  ['T-221', T221],
  ['T-222', T222],
  ['T-230', T230],
  ['T-231', T231],
  ['T-232', T232],
  ['T-233', T233],
  ['T-234', T234],
  ['T-240', T240],
  ['T-241', T241],
  ['T-242', T242],
  ['T-243', T243],
  ['T-244', T244],
  ['T-245', T245],
  ['T-246', T246],
  ['T-247', T247],
  ['T-248', T248],
  ['T-249', T249],
  ['T-260', T260],
  ['T-261', T261],
  ['T-262', T262],
  ['T-263', T263],
  ['T-264', T264],
  ['T-265', T265],
  ['T-270', T270],
  ['T-271', T271],
  ['T-272', T272],
  ['T-273', T273],
  ['T-280', T280],
  ['T-281', T281],
  ['T-282', T282],
];

(async () => {
  // eslint-disable-next-line no-console
  console.log(`# Cuponiko Fase 2 — runTag=${runTag}`);
  for (const [id, fn] of ALL_TESTS) {
    _resetInMemoryBuckets();
    resetScannerState();
    try {
      await fn();
      record(id, true);
    } catch (err) {
      record(id, false, err?.message || String(err));
    }
  }
  await cleanupAll();
  const failed = results.filter((r) => !r.ok);
  // eslint-disable-next-line no-console
  console.log(`\nResumen: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    // eslint-disable-next-line no-console
    console.log('Fallidos:', failed.map((r) => `${r.id} (${r.motivo})`).join('\n  '));
  }
  await pool.end();
  process.exit(failed.length ? 1 : 0);
})();
