#!/usr/bin/env node
'use strict';

/**
 * Runner autónomo de tests de aceptación para Fase 3 de Cuponiko.
 *
 * Cobertura:
 *  - Lealtad:   T-300, T-301, T-302, T-303, T-304, T-305, T-306
 *  - Anuncios:  ⚡T-310, ⚡T-311, T-312, T-313
 *  - Antifraude: ⚡T-320, T-321, T-322
 *  - Jobs:      T-330, T-331, T-332
 *  - Admin:     T-340, T-341
 *
 * Cada test crea sus propios usuarios/negocios con prefijo `t3_<runTag>_*`
 * para limpieza confiable al final.
 */

process.env.NODE_ENV = 'test';
process.env.MOCK_EXTERNAL_SERVICES = 'true';
process.env.RATE_LIMIT_GLOBAL_PER_MIN =
  process.env.RATE_LIMIT_GLOBAL_PER_MIN || '5000';
require('dotenv').config();

const request = require('supertest');
const crypto = require('crypto');

const { buildApp } = require('../src/app');
const { pool, query } = require('../src/config/db');
const { hashPassword } = require('../src/utils/hash');
const { signAccessToken } = require('../src/utils/jwt');
const { _resetAll: resetScannerState } = require('../src/middleware/scannerLimiter');
const { _resetInMemoryBuckets } = require('../src/middleware/rateLimiter');
const env = require('../src/config/env');
const adsService = require('../src/services/adsService');

const app = buildApp();
const agent = () => request(app);
const runTag = `phase3_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
const PREFIX = `t3_${runTag}_`;

const results = [];
function record(id, ok, motivo) {
  results.push({ id, ok, motivo });
  const tag = ok ? 'PASS' : 'FAIL';
  const msg = ok ? '' : `: ${motivo}`;
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

async function createAdmin(label = 'a') {
  const email = uniqEmail(label);
  const ph = await hashPassword('password1');
  const r = await query(
    `INSERT INTO users (email, password_hash, full_name, role, is_active, email_verified)
     VALUES ($1, $2, $3, 'admin', TRUE, TRUE)
     RETURNING id, email, role, full_name`,
    [email, ph, `Admin ${label}`]
  );
  const user = r.rows[0];
  user.access_token = tokenFor(user);
  return user;
}

async function createBusiness(label = 'b', { plan = 'free', status = 'active' } = {}) {
  const email = uniqEmail(label);
  const ph = await hashPassword('password1');
  const r = await query(
    `INSERT INTO users (email, password_hash, full_name, phone, role, is_active,
                        email_verified, phone_verified)
     VALUES ($1, $2, $3, $4, 'business', TRUE, TRUE, TRUE)
     RETURNING id, email, role, full_name`,
    [email, ph, `Biz ${label}`, `+521${crypto.randomInt(1000000000, 9999999999)}`]
  );
  const user = r.rows[0];
  const b = await query(
    `INSERT INTO businesses (user_id, business_name, category, lat, lng, display_address,
                             plan, status)
     VALUES ($1, $2, $3, $4::double precision, $5::double precision, $6, $7, $8)
     RETURNING id, plan, status`,
    [user.id, `Biz-${label}-${runTag}`, 'cafeteria', 19.4326, -99.1332, `Addr ${label}`, plan, status]
  );
  return {
    user: { ...user, access_token: tokenFor(user) },
    business: b.rows[0],
  };
}

async function createLoyaltyCard(businessId, { stamps_required = 10 } = {}) {
  const r = await query(
    `INSERT INTO loyalty_cards (business_id, name, reward_description, stamps_required, is_active)
     VALUES ($1, $2, $3, $4, TRUE)
     RETURNING *`,
    [businessId, `Card ${runTag}`, 'Café gratis', stamps_required]
  );
  return r.rows[0];
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
      row.title, row.description, row.discount_type, row.discount_value,
      row.precio_referencia, row.start_date, row.end_date,
      row.usage_limit_per_user, row.total_usage_limit,
      row.transferable, row.accumulable, row.max_accumulated_discount,
      row.max_coupons_per_tx, row.single_use, row.is_ad_exclusive, row.status,
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

async function joinLoyaltyDirect(consumerId, loyaltyCardId, { hoursValid = 24 } = {}) {
  const ins = await query(
    `INSERT INTO consumer_loyalty (consumer_id, loyalty_card_id) VALUES ($1, $2) RETURNING id`,
    [consumerId, loyaltyCardId]
  );
  const consumerLoyaltyId = ins.rows[0].id;
  const qrToken = crypto.randomUUID().replace(/-/g, '');
  const validUntil = new Date(Date.now() + hoursValid * 3600 * 1000);
  await query(
    `INSERT INTO loyalty_qr_codes (consumer_loyalty_id, qr_token, valid_until)
     VALUES ($1, $2, $3)`,
    [consumerLoyaltyId, qrToken, validUntil.toISOString()]
  );
  return { consumerLoyaltyId, qrToken, validUntil };
}

// ────────────────────────────────────────────────────────────
// LEALTAD
// ────────────────────────────────────────────────────────────

async function T300() {
  const consumer = await createConsumer('t300c');
  const { business } = await createBusiness('t300b');
  const card = await createLoyaltyCard(business.id);
  const res = await agent()
    .post('/api/loyalty/join')
    .set('Authorization', `Bearer ${consumer.access_token}`)
    .send({ loyalty_card_id: card.id });
  if (res.status !== 200) throw new Error(`status ${res.status} body=${JSON.stringify(res.body)}`);
  const data = res.body?.data;
  if (!data?.consumer_loyalty_id) throw new Error('sin consumer_loyalty_id');
  if (data.stamps_count !== 0) throw new Error(`stamps_count=${data.stamps_count}`);
  if (!data.qr_token) throw new Error('sin qr_token');
  // DB checks
  const cl = await query(`SELECT * FROM consumer_loyalty WHERE id=$1`, [data.consumer_loyalty_id]);
  if (cl.rowCount === 0) throw new Error('consumer_loyalty no insertado');
  if (cl.rows[0].stamps_count !== 0) throw new Error('stamps_count en DB != 0');
  const qr = await query(`SELECT * FROM loyalty_qr_codes WHERE consumer_loyalty_id=$1`, [data.consumer_loyalty_id]);
  if (qr.rowCount === 0) throw new Error('loyalty_qr_codes no insertado');
  const validMs = new Date(qr.rows[0].valid_until).getTime() - Date.now();
  // 24h ± 5min de margen
  if (validMs < 23.5 * 3600 * 1000 || validMs > 24.5 * 3600 * 1000) {
    throw new Error(`valid_until off by ${validMs}ms`);
  }
}

async function T301() {
  const consumer = await createConsumer('t301c');
  const { business } = await createBusiness('t301b');
  const card = await createLoyaltyCard(business.id);
  await joinLoyaltyDirect(consumer.id, card.id);
  const res = await agent()
    .post('/api/loyalty/join')
    .set('Authorization', `Bearer ${consumer.access_token}`)
    .send({ loyalty_card_id: card.id });
  if (res.status !== 409) throw new Error(`status ${res.status}`);
  if (res.body?.code !== 'ALREADY_JOINED') throw new Error(`code ${res.body?.code}`);
}

async function T302() {
  const consumer = await createConsumer('t302c');
  const { user: bizUser, business } = await createBusiness('t302b');
  const card = await createLoyaltyCard(business.id, { stamps_required: 10 });
  const { consumerLoyaltyId, qrToken } = await joinLoyaltyDirect(consumer.id, card.id);
  await query(`UPDATE consumer_loyalty SET stamps_count=4 WHERE id=$1`, [consumerLoyaltyId]);
  const res = await agent()
    .post('/api/loyalty/stamp')
    .set('Authorization', `Bearer ${bizUser.access_token}`)
    .send({ qr_token: qrToken });
  if (res.status !== 200) throw new Error(`status ${res.status} body=${JSON.stringify(res.body)}`);
  if (res.body?.data?.stamps_count !== 5) throw new Error(`stamps_count=${res.body?.data?.stamps_count}`);
  const cl = await query(`SELECT stamps_count FROM consumer_loyalty WHERE id=$1`, [consumerLoyaltyId]);
  if (cl.rows[0].stamps_count !== 5) throw new Error(`DB stamps=${cl.rows[0].stamps_count}`);
}

async function T303() {
  const consumer = await createConsumer('t303c');
  const { user: bizUser, business } = await createBusiness('t303b');
  const card = await createLoyaltyCard(business.id);
  const { consumerLoyaltyId, qrToken } = await joinLoyaltyDirect(consumer.id, card.id);
  // Forzar valid_until al pasado
  await query(
    `UPDATE loyalty_qr_codes SET valid_until = NOW() - INTERVAL '1 minute' WHERE consumer_loyalty_id=$1`,
    [consumerLoyaltyId]
  );
  const res = await agent()
    .post('/api/loyalty/stamp')
    .set('Authorization', `Bearer ${bizUser.access_token}`)
    .send({ qr_token: qrToken });
  if (res.status !== 400) throw new Error(`status ${res.status}`);
  if (res.body?.error !== 'QR expirado. El cliente debe actualizar su QR.') {
    throw new Error(`msg=${res.body?.error}`);
  }
}

async function T304() {
  const consumer = await createConsumer('t304c');
  const { business: biz1 } = await createBusiness('t304b1');
  const { user: bizUser2 } = await createBusiness('t304b2');
  const card = await createLoyaltyCard(biz1.id);
  const { qrToken } = await joinLoyaltyDirect(consumer.id, card.id);
  const res = await agent()
    .post('/api/loyalty/stamp')
    .set('Authorization', `Bearer ${bizUser2.access_token}`)
    .send({ qr_token: qrToken });
  if (res.status !== 403) throw new Error(`status ${res.status}`);
  if (res.body?.error !== 'Esta tarjeta no pertenece a tu negocio.') {
    throw new Error(`msg=${res.body?.error}`);
  }
}

async function T305() {
  const consumer = await createConsumer('t305c');
  const { user: bizUser, business } = await createBusiness('t305b');
  const card = await createLoyaltyCard(business.id, { stamps_required: 5 });
  const { consumerLoyaltyId, qrToken } = await joinLoyaltyDirect(consumer.id, card.id);
  await query(`UPDATE consumer_loyalty SET stamps_count=5 WHERE id=$1`, [consumerLoyaltyId]);
  const res = await agent()
    .post('/api/loyalty/stamp')
    .set('Authorization', `Bearer ${bizUser.access_token}`)
    .send({ qr_token: qrToken });
  if (res.status !== 400) throw new Error(`status ${res.status}`);
  if (res.body?.error !== 'Este cliente ya tiene la recompensa disponible.') {
    throw new Error(`msg=${res.body?.error}`);
  }
}

async function T306() {
  const consumer = await createConsumer('t306c');
  const { business } = await createBusiness('t306b');
  const card = await createLoyaltyCard(business.id);
  const { consumerLoyaltyId, qrToken: oldToken } = await joinLoyaltyDirect(consumer.id, card.id);
  // Forzar valid_until corto
  await query(
    `UPDATE loyalty_qr_codes SET valid_until = NOW() + INTERVAL '30 minutes' WHERE consumer_loyalty_id=$1`,
    [consumerLoyaltyId]
  );
  const res = await agent()
    .post(`/api/loyalty/${consumerLoyaltyId}/refresh-qr`)
    .set('Authorization', `Bearer ${consumer.access_token}`);
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  const newToken = res.body?.data?.qr_token;
  if (!newToken || newToken === oldToken) throw new Error('qr_token no cambió');
  const validMs = new Date(res.body.data.valid_until).getTime() - Date.now();
  if (validMs < 23.5 * 3600 * 1000 || validMs > 24.5 * 3600 * 1000) {
    throw new Error(`valid_until off ${validMs}ms`);
  }
}

// ────────────────────────────────────────────────────────────
// ANUNCIOS
// ────────────────────────────────────────────────────────────

async function T310() {
  const { user: bizUser, business } = await createBusiness('t310b', { plan: 'premium' });
  const res = await agent()
    .post('/api/ads/create')
    .set('Authorization', `Bearer ${bizUser.access_token}`)
    .send({
      title: `Ad ${runTag}`,
      image_url: 'https://example.test/ad.jpg',
      discount_type: 'percent',
      discount_value: 15,
      start_date: todayPlus(0),
      end_date: todayPlus(7),
      redemption_limit: 50,
      cost_type: 'cpc',
      cost_value: 1.5,
    });
  if (res.status !== 201) throw new Error(`status ${res.status} body=${JSON.stringify(res.body)}`);
  const { ad_id, coupon_id } = res.body.data;
  const c = await query(
    `SELECT is_ad_exclusive, accumulable, transferable, ad_id FROM coupons WHERE id=$1`,
    [coupon_id]
  );
  if (c.rowCount === 0) throw new Error('cupón no insertado');
  const row = c.rows[0];
  if (!row.is_ad_exclusive) throw new Error('is_ad_exclusive=false');
  if (row.accumulable) throw new Error('accumulable=true');
  if (row.transferable) throw new Error('transferable=true');
  if (Number(row.ad_id) !== Number(ad_id)) throw new Error(`coupons.ad_id=${row.ad_id}`);
  const a = await query(`SELECT coupon_id FROM anuncios_pagados WHERE id=$1`, [ad_id]);
  if (a.rowCount === 0) throw new Error('anuncio no insertado');
  if (Number(a.rows[0].coupon_id) !== Number(coupon_id)) throw new Error('anuncio.coupon_id mismatch');
}

async function T311() {
  const { user: bizUser, business } = await createBusiness('t311b', { plan: 'premium' });
  const couponsBefore = await query(
    `SELECT COUNT(*)::int n FROM coupons WHERE business_id=$1`,
    [business.id]
  );
  const adsBefore = await query(
    `SELECT COUNT(*)::int n FROM anuncios_pagados WHERE business_id=$1`,
    [business.id]
  );
  // Armar el hook que fuerza fallo después del INSERT del cupón
  adsService._armFailAfterCouponInsert();
  const res = await agent()
    .post('/api/ads/create')
    .set('Authorization', `Bearer ${bizUser.access_token}`)
    .send({
      title: `Ad-fail ${runTag}`,
      image_url: 'https://example.test/ad.jpg',
      discount_type: 'percent',
      discount_value: 15,
      start_date: todayPlus(0),
      end_date: todayPlus(7),
      redemption_limit: 50,
      cost_type: 'flat',
      cost_value: 100,
    });
  if (res.status === 201) throw new Error('esperaba fallo, fue 201');
  const couponsAfter = await query(
    `SELECT COUNT(*)::int n FROM coupons WHERE business_id=$1`,
    [business.id]
  );
  const adsAfter = await query(
    `SELECT COUNT(*)::int n FROM anuncios_pagados WHERE business_id=$1`,
    [business.id]
  );
  if (couponsAfter.rows[0].n !== couponsBefore.rows[0].n) {
    throw new Error(`coupons cambió: ${couponsBefore.rows[0].n} → ${couponsAfter.rows[0].n} (no rollback)`);
  }
  if (adsAfter.rows[0].n !== adsBefore.rows[0].n) {
    throw new Error(`anuncios cambió: ${adsBefore.rows[0].n} → ${adsAfter.rows[0].n}`);
  }
}

async function T312() {
  const { user: bizUser } = await createBusiness('t312b', { plan: 'premium' });
  const res = await agent()
    .post('/api/ads/create')
    .set('Authorization', `Bearer ${bizUser.access_token}`)
    .send({
      title: `Ad2x1 ${runTag}`,
      image_url: 'https://example.test/ad.jpg',
      discount_type: '2x1',
      discount_value: 50,
      precio_referencia: null,
      start_date: todayPlus(0),
      end_date: todayPlus(7),
      redemption_limit: 50,
      cost_type: 'cpc',
      cost_value: 1.5,
    });
  if (res.status !== 400) throw new Error(`status ${res.status}`);
  if (!/precio de referencia/i.test(res.body?.error || '')) {
    throw new Error(`msg=${res.body?.error}`);
  }
}

async function T313() {
  // Crear 7 anuncios activos para ver que carrusel HOME-03 limita a 5
  const { business } = await createBusiness('t313b', { plan: 'premium' });
  const consumer = await createConsumer('t313c');
  const created = [];
  for (let i = 0; i < 7; i++) {
    const c = await createCouponDirect(business.id, {
      title: `c${i}-${runTag}`,
      is_ad_exclusive: true,
      accumulable: false,
      transferable: false,
    });
    const a = await query(
      `INSERT INTO anuncios_pagados (business_id, coupon_id, image_url, start_date, end_date,
                                     cost_type, cost_value, redemption_limit, status)
       VALUES ($1,$2,$3,$4,$5,'cpc',1.5,50,'active')
       RETURNING id`,
      [business.id, c.id, `https://img.test/${i}.jpg`, todayPlus(0), todayPlus(7)]
    );
    await query(`UPDATE coupons SET ad_id=$1 WHERE id=$2`, [a.rows[0].id, c.id]);
    created.push(a.rows[0].id);
  }
  const res = await agent()
    .get('/api/ads/active')
    .set('Authorization', `Bearer ${consumer.access_token}`);
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  const ads = res.body?.data?.ads || [];
  if (ads.length > 5) throw new Error(`carrusel devolvió ${ads.length} (>5)`);
}

// ────────────────────────────────────────────────────────────
// ANTIFRAUDE
// ────────────────────────────────────────────────────────────

async function T320() {
  // Reusar token: crear cupón, instance, redemption_token "used", llamar redeem.
  const consumer = await createConsumer('t320c');
  const { user: bizUser, business } = await createBusiness('t320b');
  const c = await createCouponDirect(business.id, { transferable: false });
  const ciId = await saveCouponDirect(c.id, consumer.id);
  const shortCode = `T${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
  const tokenHash = crypto.createHash('sha256').update(`fake-${runTag}`).digest('hex');
  await query(
    `INSERT INTO redemption_tokens (coupon_instance_id, token_jwt_hash, short_code,
                                    expires_at, status, used_at, business_id)
     VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes', 'used', NOW(), $4)`,
    [ciId, tokenHash, shortCode, business.id]
  );
  const alertsBefore = await query(
    `SELECT COUNT(*)::int n FROM alerts WHERE type='token_reuse' AND business_id=$1`,
    [business.id]
  );
  const res = await agent()
    .post('/api/coupons/redeem')
    .set('Authorization', `Bearer ${bizUser.access_token}`)
    .send({ short_code: shortCode });
  if (res.status !== 409) throw new Error(`status ${res.status} body=${JSON.stringify(res.body)}`);
  if (res.body?.code !== 'ALREADY_REDEEMED') throw new Error(`code ${res.body?.code}`);
  const alertsAfter = await query(
    `SELECT COUNT(*)::int n FROM alerts WHERE type='token_reuse' AND business_id=$1`,
    [business.id]
  );
  if (alertsAfter.rows[0].n !== alertsBefore.rows[0].n + 1) {
    throw new Error(`alerts no incrementó: ${alertsBefore.rows[0].n} → ${alertsAfter.rows[0].n}`);
  }
}

async function T321() {
  // Simular 3 bloqueos en la última hora insertando activity_logs y disparar 3er
  const { business } = await createBusiness('t321b');
  await query(
    `INSERT INTO activity_logs (business_id, action, metadata) VALUES
       ($1, 'scanner_rate_limit_triggered', '{}'::jsonb),
       ($1, 'scanner_rate_limit_triggered', '{}'::jsonb)`,
    [business.id]
  );
  const { registerScanFailure } = require('../src/middleware/scannerLimiter');
  // 3 fallos consecutivos para gatillar el bloqueo
  await registerScanFailure(business.id);
  await registerScanFailure(business.id);
  await registerScanFailure(business.id);
  // Esperar un tick para que la query INSERT alerts complete
  await new Promise((r) => setTimeout(r, 200));
  const a = await query(
    `SELECT COUNT(*)::int n FROM alerts WHERE type='rate_limit_repeat' AND business_id=$1`,
    [business.id]
  );
  if (a.rows[0].n < 1) throw new Error('alerta rate_limit_repeat no creada');
  const sev = await query(
    `SELECT severity FROM alerts WHERE type='rate_limit_repeat' AND business_id=$1 LIMIT 1`,
    [business.id]
  );
  if (sev.rows[0].severity !== 'medium') throw new Error(`severity=${sev.rows[0].severity}`);
}

async function T322() {
  const { user: bizUser } = await createBusiness('t322b');
  const consumer = await createConsumer('t322c');
  const res = await agent()
    .post('/api/alerts/report')
    .set('Authorization', `Bearer ${bizUser.access_token}`)
    .send({ consumer_id: consumer.id, description: `Comportamiento sospechoso ${runTag}` });
  if (res.status !== 201) throw new Error(`status ${res.status} body=${JSON.stringify(res.body)}`);
  const alertId = res.body?.data?.alert_id;
  const a = await query(`SELECT type FROM alerts WHERE id=$1`, [alertId]);
  if (a.rowCount === 0) throw new Error('alerta no insertada');
  if (a.rows[0].type !== 'manual_report') throw new Error(`type=${a.rows[0].type}`);
}

// ────────────────────────────────────────────────────────────
// JOBS
// ────────────────────────────────────────────────────────────

async function T330() {
  const consumer = await createConsumer('t330c');
  const { business } = await createBusiness('t330b');
  // Crear cupón con end_date a 20h
  const r = await query(
    `INSERT INTO coupons (business_id, title, description, discount_type, discount_value,
                          precio_referencia, start_date, end_date, usage_limit_per_user,
                          total_usage_limit, transferable, accumulable,
                          max_accumulated_discount, max_coupons_per_tx, single_use,
                          is_ad_exclusive, status)
     VALUES ($1, $2, 'd', 'percent', 10, NULL, CURRENT_DATE,
             (NOW() + INTERVAL '20 hours')::date, 1, 100, FALSE, FALSE, 70, 2, TRUE, FALSE, 'active')
     RETURNING id`,
    [business.id, `c-${runTag}`]
  );
  const couponId = r.rows[0].id;
  // Forzar end_date exacto NOW+20h via update con cast a date no funciona — usamos una columna timestamp ficticia? No; el query del job filtra `BETWEEN NOW() AND NOW()+24h` sobre end_date::date, y como end_date es DATE, el rango queda en hoy o mañana. Aseguramos fila válida poniéndolo a hoy+1.
  await query(`UPDATE coupons SET end_date = (NOW() + INTERVAL '20 hours')::date WHERE id=$1`, [couponId]);
  await saveCouponDirect(couponId, consumer.id);
  const notifBefore = await query(
    `SELECT COUNT(*)::int n FROM notifications WHERE user_id=$1 AND type='coupon_expiry_reminder'`,
    [consumer.id]
  );
  const res = await agent()
    .post('/internal/jobs/coupon-expiry-notifier')
    .set('x-internal-secret', env.INTERNAL_SECRET);
  if (res.status !== 200) throw new Error(`status ${res.status} body=${JSON.stringify(res.body)}`);
  const notifAfter = await query(
    `SELECT COUNT(*)::int n FROM notifications WHERE user_id=$1 AND type='coupon_expiry_reminder'`,
    [consumer.id]
  );
  if (notifAfter.rows[0].n <= notifBefore.rows[0].n) {
    throw new Error('no se creó la notificación');
  }
  // Verificar log
  const log = await query(
    `SELECT status FROM scheduled_jobs_log WHERE job_name='coupon_expiry_notifier' ORDER BY id DESC LIMIT 1`
  );
  if (log.rowCount === 0) throw new Error('sin scheduled_jobs_log');
  if (!['success', 'partial'].includes(log.rows[0].status)) {
    throw new Error(`status=${log.rows[0].status}`);
  }
}

async function T331() {
  const consumer = await createConsumer('t331c');
  const { business } = await createBusiness('t331b');
  const cr = await query(
    `INSERT INTO coupons (business_id, title, description, discount_type, discount_value,
                          start_date, end_date, usage_limit_per_user, total_usage_limit,
                          transferable, accumulable, max_accumulated_discount, max_coupons_per_tx,
                          single_use, is_ad_exclusive, status)
     VALUES ($1, $2, 'd', 'percent', 10, CURRENT_DATE,
             (NOW() + INTERVAL '20 hours')::date, 1, 100, FALSE, FALSE, 70, 2, TRUE, FALSE, 'active')
     RETURNING id`,
    [business.id, `c-${runTag}-31`]
  );
  const couponId = cr.rows[0].id;
  await saveCouponDirect(couponId, consumer.id);
  // Insertar notificación previa hace 10h
  await query(
    `INSERT INTO notifications (user_id, type, title, body, data, created_at)
     VALUES ($1, 'coupon_expiry_reminder', 't', 'b', $2::jsonb, NOW() - INTERVAL '10 hours')`,
    [consumer.id, JSON.stringify({ coupon_id: Number(couponId) })]
  );
  const notifBefore = await query(
    `SELECT COUNT(*)::int n FROM notifications WHERE user_id=$1 AND type='coupon_expiry_reminder'`,
    [consumer.id]
  );
  const res = await agent()
    .post('/internal/jobs/coupon-expiry-notifier')
    .set('x-internal-secret', env.INTERNAL_SECRET);
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  const notifAfter = await query(
    `SELECT COUNT(*)::int n FROM notifications WHERE user_id=$1 AND type='coupon_expiry_reminder'`,
    [consumer.id]
  );
  if (notifAfter.rows[0].n !== notifBefore.rows[0].n) {
    throw new Error(`re-notificó: ${notifBefore.rows[0].n} → ${notifAfter.rows[0].n}`);
  }
}

async function T332() {
  const consumerA = await createConsumer('t332a');
  const consumerB = await createConsumer('t332b');
  const { business } = await createBusiness('t332b');
  const c = await createCouponDirect(business.id);
  const ciA = await saveCouponDirect(c.id, consumerA.id);
  const ciB = await saveCouponDirect(c.id, consumerB.id);
  // 5 redenciones para A en últimos 10 días
  for (let i = 0; i < 5; i++) {
    await query(
      `INSERT INTO redemptions (coupon_instance_id, business_id, consumer_id,
                                discount_applied, redeemed_at)
       VALUES ($1, $2, $3, 1.50, NOW() - (INTERVAL '1 day' * $4))`,
      [ciA, business.id, consumerA.id, i * 2]
    );
  }
  // 1 redención para B hace 45 días
  await query(
    `INSERT INTO redemptions (coupon_instance_id, business_id, consumer_id,
                              discount_applied, redeemed_at)
     VALUES ($1, $2, $3, 1.50, NOW() - INTERVAL '45 days')`,
    [ciB, business.id, consumerB.id]
  );

  const res = await agent()
    .post('/internal/jobs/loyalty-inactivity-tagger')
    .set('x-internal-secret', env.INTERNAL_SECRET);
  if (res.status !== 200) throw new Error(`status ${res.status} body=${JSON.stringify(res.body)}`);

  // Buscar el último segmento por consumer
  const segA = await query(
    `SELECT metadata->>'segment' AS seg FROM activity_logs
      WHERE user_id=$1 AND business_id=$2 AND action='loyalty_segment'
      ORDER BY id DESC LIMIT 1`,
    [consumerA.id, business.id]
  );
  if (segA.rowCount === 0) throw new Error('A sin segmento');
  if (segA.rows[0].seg !== 'frecuente') {
    throw new Error(`A segmento=${segA.rows[0].seg} (esperaba frecuente)`);
  }
  const segB = await query(
    `SELECT metadata->>'segment' AS seg FROM activity_logs
      WHERE user_id=$1 AND business_id=$2 AND action='loyalty_segment'
      ORDER BY id DESC LIMIT 1`,
    [consumerB.id, business.id]
  );
  if (segB.rowCount === 0) throw new Error('B sin segmento');
  if (segB.rows[0].seg !== 'inactivo') {
    throw new Error(`B segmento=${segB.rows[0].seg} (esperaba inactivo)`);
  }
}

// ────────────────────────────────────────────────────────────
// ADMIN
// ────────────────────────────────────────────────────────────

async function T340() {
  const admin = await createAdmin('t340a');
  const { business } = await createBusiness('t340b');
  const couponIds = [];
  for (let i = 0; i < 3; i++) {
    const c = await createCouponDirect(business.id, { title: `c${i}-${runTag}` });
    couponIds.push(c.id);
  }
  const c1 = await createConsumer('t340c1');
  const c2 = await createConsumer('t340c2');
  await saveCouponDirect(couponIds[0], c1.id);
  await saveCouponDirect(couponIds[1], c2.id);
  // Suspender
  const res = await agent()
    .patch(`/api/admin/businesses/${business.id}/suspend`)
    .set('Authorization', `Bearer ${admin.access_token}`);
  if (res.status !== 200) throw new Error(`status ${res.status} body=${JSON.stringify(res.body)}`);
  // Verificar status
  const b = await query(`SELECT status FROM businesses WHERE id=$1`, [business.id]);
  if (b.rows[0].status !== 'suspended') throw new Error(`business.status=${b.rows[0].status}`);
  // Cupones siguen activos
  const cs = await query(`SELECT status FROM coupons WHERE business_id=$1`, [business.id]);
  for (const row of cs.rows) {
    if (row.status !== 'active') throw new Error(`cupón cambió a ${row.status}`);
  }
  // /api/businesses/nearby NO retorna ese negocio
  const nearby = await agent()
    .get('/api/businesses/nearby')
    .set('Authorization', `Bearer ${c1.access_token}`)
    .query({ lat: 19.4326, lng: -99.1332, radius: 5000 });
  if (nearby.status !== 200) throw new Error(`nearby status ${nearby.status}`);
  const found = (nearby.body?.data?.businesses || []).find(
    (x) => Number(x.id) === Number(business.id)
  );
  if (found) throw new Error('negocio suspendido aparece en nearby');
}

async function T341() {
  const admin = await createAdmin('t341a');
  const consumer = await createConsumer('t341c');
  // Setear push_token previo
  await query(`UPDATE users SET push_token='ExpoToken-test' WHERE id=$1`, [consumer.id]);
  const res = await agent()
    .patch(`/api/admin/users/${consumer.id}/block`)
    .set('Authorization', `Bearer ${admin.access_token}`);
  if (res.status !== 200) throw new Error(`status ${res.status} body=${JSON.stringify(res.body)}`);
  const u = await query(`SELECT is_active, push_token, password_hash FROM users WHERE id=$1`, [consumer.id]);
  if (u.rows[0].is_active !== false) throw new Error(`is_active=${u.rows[0].is_active}`);
  if (u.rows[0].push_token !== null) throw new Error(`push_token=${u.rows[0].push_token}`);
  // Login bloqueado (regresión T-132): mismo password
  const login = await agent()
    .post('/api/auth/login')
    .send({ email: consumer.email, password: 'password1' });
  if (login.status !== 403) throw new Error(`login status=${login.status} body=${JSON.stringify(login.body)}`);
  if (login.body?.code !== 'ACCOUNT_BLOCKED') throw new Error(`login code=${login.body?.code}`);
}

// ────────────────────────────────────────────────────────────
// CLEANUP
// ────────────────────────────────────────────────────────────
async function cleanupAll() {
  try {
    // Borrar alertas, notifications, scheduled_jobs_log de la corrida primero
    await query(`DELETE FROM alerts WHERE description LIKE '%' || $1 || '%'`, [runTag]).catch(() => {});
    await query(`DELETE FROM scheduled_jobs_log WHERE error_detail LIKE '%' || $1 || '%'`, [runTag]).catch(() => {});
    // Borrar usuarios por prefijo (CASCADE limpia el resto)
    await query(
      `DELETE FROM users WHERE email LIKE $1 || '%' OR full_name LIKE $1 || '%'`,
      [PREFIX]
    );
    await query(
      `DELETE FROM activity_logs WHERE metadata::text LIKE '%' || $1 || '%'`,
      [runTag]
    );
  } catch (err) {
    console.error('[cleanup warn]', err.message);
  }
}

const ALL_TESTS = [
  ['T-300', T300],
  ['T-301', T301],
  ['T-302', T302],
  ['T-303', T303],
  ['T-304', T304],
  ['T-305', T305],
  ['T-306', T306],
  ['T-310', T310],
  ['T-311', T311],
  ['T-312', T312],
  ['T-313', T313],
  ['T-320', T320],
  ['T-321', T321],
  ['T-322', T322],
  ['T-330', T330],
  ['T-331', T331],
  ['T-332', T332],
  ['T-340', T340],
  ['T-341', T341],
];

(async () => {
  console.log(`# Cuponiko Fase 3 — runTag=${runTag}`);
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
  console.log(`\nResumen: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    console.log('Fallidos:');
    for (const r of failed) console.log(`  ${r.id}: ${r.motivo}`);
  }
  await pool.end();
  process.exit(failed.length ? 1 : 0);
})();
