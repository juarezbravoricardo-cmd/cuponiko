#!/usr/bin/env node
'use strict';
/**
 * Runner autónomo de tests de aceptación para Fase 3.5 de Cuponiko.
 *
 * Cobertura:
 *  - Migración:           T-400
 *  - Notificaciones:      T-410..T-415
 *  - Push token:          T-420, T-421, ⚡T-422
 *  - Eliminación cuenta:  T-430..T-432, ⚡T-433, ⚡T-434, T-435, T-436
 *  - Exportación PDF:     T-440..T-446
 *  - Perfiles públicos:   T-450..T-455
 *  - Push segmentos:      T-460..T-463, ⚡T-464
 *
 * Cada test crea sus propios usuarios/negocios con prefijo `t35_<runTag>_*`
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
const { hashPassword, sha256 } = require('../src/utils/hash');
const { signAccessToken } = require('../src/utils/jwt');
const { _resetInMemoryBuckets } = require('../src/middleware/rateLimiter');
const exportsSvc = require('../src/services/exportsService');

const app = buildApp();
const agent = () => request(app);

const runTag = `phase35_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
const PREFIX = `t35_${runTag}_`;

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
    [email, ph, `${PREFIX}Consumer-${label}`]
  );
  const user = r.rows[0];
  user.access_token = tokenFor(user);
  return user;
}

async function createBusiness(label = 'b', { plan = 'free', status = 'active', subStatus = null } = {}) {
  const email = uniqEmail(label);
  const ph = await hashPassword('password1');
  const r = await query(
    `INSERT INTO users (email, password_hash, full_name, phone, role, is_active,
                        email_verified, phone_verified)
     VALUES ($1, $2, $3, $4, 'business', TRUE, TRUE, TRUE)
     RETURNING id, email, role, full_name`,
    [email, ph, `${PREFIX}Biz-${label}`, `+521${crypto.randomInt(1000000000, 9999999999)}`]
  );
  const user = r.rows[0];
  const b = await query(
    `INSERT INTO businesses (user_id, business_name, category, lat, lng, display_address,
                             location, plan, status, subscription_status,
                             stripe_customer_id, stripe_subscription_id)
     VALUES ($1, $2, $3, $4::double precision, $5::double precision, $6,
             ST_SetSRID(ST_MakePoint($5::double precision, $4::double precision), 4326)::geography,
             $7, $8, $9, $10, $11)
     RETURNING id, plan, status`,
    [
      user.id,
      `${PREFIX}Biz-${label}`,
      'cafeteria',
      19.4326,
      -99.1332,
      `Addr ${label}`,
      plan,
      status,
      subStatus,
      plan === 'premium' ? `cus_mock_${user.id}` : null,
      subStatus ? `sub_mock_${user.id}` : null,
    ]
  );
  return {
    user: { ...user, access_token: tokenFor(user) },
    business: b.rows[0],
  };
}

async function insertNotif(userId, { title = 'Notif', body = 'Body', type = 'generic', read = false, createdMinutesAgo = 0, data = {} } = {}) {
  const r = await query(
    `INSERT INTO notifications (user_id, type, title, body, data, read, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW() - ($7 || ' minutes')::interval)
     RETURNING id`,
    [userId, type, title, body, JSON.stringify(data), read, String(createdMinutesAgo)]
  );
  return Number(r.rows[0].id);
}

async function createCouponDirect(businessId, { title = 'C', total = 100, uses = 0, status = 'active', endOffsetDays = 30 } = {}) {
  const r = await query(
    `INSERT INTO coupons (business_id, title, description, discount_type, discount_value,
                          precio_referencia, start_date, end_date,
                          usage_limit_per_user, total_usage_limit, uses_count, status)
     VALUES ($1, $2, 'desc', 'percent', 10, 100,
             CURRENT_DATE - INTERVAL '1 day',
             CURRENT_DATE + ($6::int || ' days')::interval,
             1, $3, $4, $5)
     RETURNING id`,
    [businessId, `${PREFIX}${title}`, total, uses, status, endOffsetDays]
  );
  return Number(r.rows[0].id);
}

async function getLastEmailToken(userId) {
  // El runner no puede leer el código en claro: lo recreamos vía hash.
  // Para tests usamos un código fijo conocido y lo plantamos directo en DB.
  return null;
}

async function plantDeletionCode(userId, email, code = '123456', expiresInMinutes = 30) {
  const codeHash = sha256(code);
  await query(
    `INSERT INTO email_verification_tokens (user_id, email, code_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' minutes')::interval)`,
    [userId, email, codeHash, String(expiresInMinutes)]
  );
  return code;
}

// ────────────────────────────────────────────────────────────
// MIGRACIÓN
// ────────────────────────────────────────────────────────────
async function T400() {
  const cols = await query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name='exports' AND table_schema='public'`
  );
  const have = new Set(cols.rows.map((r) => r.column_name));
  const need = ['id','business_id','user_id','type','status','file_path','file_url','expires_at','error_message','created_at','completed_at'];
  for (const c of need) if (!have.has(c)) throw new Error(`falta columna ${c}`);
  // FKs
  const fks = await query(
    `SELECT conname, confrelid::regclass::text AS ref
       FROM pg_constraint
      WHERE conrelid='exports'::regclass AND contype='f'`
  );
  const refs = fks.rows.map((r) => r.ref);
  if (!refs.includes('businesses')) throw new Error('FK business_id ausente');
  if (!refs.includes('users')) throw new Error('FK user_id ausente');
  // Índices
  const idx = await query(
    `SELECT indexname FROM pg_indexes WHERE tablename='exports' AND schemaname='public'`
  );
  const ixs = idx.rows.map((r) => r.indexname);
  if (!ixs.includes('idx_exports_business')) throw new Error('idx_exports_business ausente');
  if (!ixs.includes('idx_exports_status')) throw new Error('idx_exports_status ausente');
}

// ────────────────────────────────────────────────────────────
// NOTIFICACIONES
// ────────────────────────────────────────────────────────────
async function T410() {
  const u = await createConsumer('t410');
  for (let i = 0; i < 15; i++) await insertNotif(u.id, { read: true, createdMinutesAgo: 100 - i });
  for (let i = 0; i < 10; i++) await insertNotif(u.id, { read: false, createdMinutesAgo: 30 - i });
  const r = await agent()
    .get('/api/notifications?page=1&limit=10')
    .set('Authorization', `Bearer ${u.access_token}`);
  if (r.status !== 200) throw new Error(`status ${r.status} body=${JSON.stringify(r.body)}`);
  const d = r.body?.data;
  if (d.notifications.length !== 10) throw new Error(`len=${d.notifications.length}`);
  if (d.pagination.total !== 25) throw new Error(`total=${d.pagination.total}`);
  if (d.pagination.total_pages !== 3) throw new Error(`pages=${d.pagination.total_pages}`);
  // ordenadas DESC: created_at[0] >= created_at[1]
  for (let i = 1; i < d.notifications.length; i++) {
    if (new Date(d.notifications[i - 1].created_at) < new Date(d.notifications[i].created_at)) {
      throw new Error('orden no es DESC');
    }
  }
}

async function T411() {
  const u = await createConsumer('t411');
  for (let i = 0; i < 15; i++) await insertNotif(u.id, { read: true });
  for (let i = 0; i < 10; i++) await insertNotif(u.id, { read: false });
  const r = await agent()
    .get('/api/notifications?unread_only=true&limit=50')
    .set('Authorization', `Bearer ${u.access_token}`);
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  const d = r.body.data;
  if (d.pagination.total !== 10) throw new Error(`total=${d.pagination.total}`);
  if (d.notifications.some((n) => n.read !== false)) throw new Error('hay leídas en respuesta');
}

async function T412() {
  const u = await createConsumer('t412');
  const r = await agent()
    .get('/api/notifications?limit=100')
    .set('Authorization', `Bearer ${u.access_token}`);
  if (r.status !== 400) throw new Error(`status ${r.status}`);
  if (r.body.code !== 'VALIDATION_ERROR') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== 'El límite máximo es 50 notificaciones por página.') {
    throw new Error(`msg=${r.body.error}`);
  }
}

async function T413() {
  const u = await createConsumer('t413');
  const id = await insertNotif(u.id, { read: false });
  const r = await agent()
    .patch(`/api/notifications/${id}/read`)
    .set('Authorization', `Bearer ${u.access_token}`);
  if (r.status !== 200) throw new Error(`status ${r.status} body=${JSON.stringify(r.body)}`);
  if (r.body.data.read !== true) throw new Error('data.read != true');
  const db = await query(`SELECT read FROM notifications WHERE id=$1`, [id]);
  if (db.rows[0].read !== true) throw new Error('DB no actualizada');
}

async function T414() {
  const a = await createConsumer('t414a');
  const b = await createConsumer('t414b');
  const id = await insertNotif(a.id);
  const r = await agent()
    .patch(`/api/notifications/${id}/read`)
    .set('Authorization', `Bearer ${b.access_token}`);
  if (r.status !== 403) throw new Error(`status ${r.status}`);
  if (r.body.code !== 'FORBIDDEN') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== 'No tienes permiso para modificar esta notificación.') {
    throw new Error(`msg=${r.body.error}`);
  }
}

async function T415() {
  const u = await createConsumer('t415');
  const r = await agent()
    .patch('/api/notifications/99999999/read')
    .set('Authorization', `Bearer ${u.access_token}`);
  if (r.status !== 404) throw new Error(`status ${r.status}`);
  if (r.body.code !== 'NOT_FOUND') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== 'Notificación no encontrada.') throw new Error(`msg=${r.body.error}`);
}

// ────────────────────────────────────────────────────────────
// PUSH TOKEN
// ────────────────────────────────────────────────────────────
async function T420() {
  const u = await createConsumer('t420');
  const tok = `ExponentPushToken[${runTag}_t420]`;
  const r = await agent()
    .post('/api/push/token')
    .set('Authorization', `Bearer ${u.access_token}`)
    .send({ push_token: tok, platform: 'ios' });
  if (r.status !== 200) throw new Error(`status ${r.status} body=${JSON.stringify(r.body)}`);
  if (r.body.data.push_token_saved !== true) throw new Error('flag != true');
  const db = await query(`SELECT push_token FROM users WHERE id=$1`, [u.id]);
  if (db.rows[0].push_token !== tok) throw new Error(`db push_token=${db.rows[0].push_token}`);
}

async function T421() {
  const u = await createConsumer('t421');
  const r = await agent()
    .post('/api/push/token')
    .set('Authorization', `Bearer ${u.access_token}`)
    .send({ push_token: 'xxx', platform: 'windows' });
  if (r.status !== 400) throw new Error(`status ${r.status}`);
  if (r.body.code !== 'VALIDATION_ERROR') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== "Plataforma debe ser 'ios' o 'android'.") throw new Error(`msg=${r.body.error}`);
}

async function T422() {
  const a = await createConsumer('t422a');
  const b = await createConsumer('t422b');
  const tok = `ExponentPushToken[${runTag}_t422]`;
  // a registra primero
  let r = await agent()
    .post('/api/push/token')
    .set('Authorization', `Bearer ${a.access_token}`)
    .send({ push_token: tok, platform: 'ios' });
  if (r.status !== 200) throw new Error(`a status=${r.status}`);
  // b lo toma
  r = await agent()
    .post('/api/push/token')
    .set('Authorization', `Bearer ${b.access_token}`)
    .send({ push_token: tok, platform: 'android' });
  if (r.status !== 200) throw new Error(`b status=${r.status}`);
  const dba = await query(`SELECT push_token FROM users WHERE id=$1`, [a.id]);
  const dbb = await query(`SELECT push_token FROM users WHERE id=$1`, [b.id]);
  if (dba.rows[0].push_token !== null) throw new Error(`a no se desvinculó: ${dba.rows[0].push_token}`);
  if (dbb.rows[0].push_token !== tok) throw new Error(`b push_token=${dbb.rows[0].push_token}`);
}

// ────────────────────────────────────────────────────────────
// ELIMINACIÓN DE CUENTA
// ────────────────────────────────────────────────────────────
async function T430() {
  const u = await createConsumer('t430');
  const r = await agent()
    .post('/api/account/delete')
    .set('Authorization', `Bearer ${u.access_token}`)
    .send({ reason: 'Ya no uso la app' });
  if (r.status !== 200) throw new Error(`status ${r.status} body=${JSON.stringify(r.body)}`);
  if (r.body.data.expires_in_minutes !== 30) throw new Error('expires_in_minutes != 30');
  const tok = await query(
    `SELECT id, expires_at FROM email_verification_tokens WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [u.id]
  );
  if (tok.rowCount === 0) throw new Error('token no creado');
  const ms = new Date(tok.rows[0].expires_at).getTime() - Date.now();
  if (ms < 28 * 60 * 1000 || ms > 32 * 60 * 1000) throw new Error(`expires_at off: ${ms}ms`);
  const log = await query(
    `SELECT id FROM activity_logs WHERE user_id=$1 AND action='delete_account_requested'`,
    [u.id]
  );
  if (log.rowCount === 0) throw new Error('activity_log faltante');
}

async function T431() {
  const u = await createConsumer('t431');
  await query(`UPDATE users SET is_active=false WHERE id=$1`, [u.id]);
  const r = await agent()
    .post('/api/account/delete')
    .set('Authorization', `Bearer ${u.access_token}`);
  // El JWT verifica is_active; el contrato dice 400 ACCOUNT_ALREADY_INACTIVE.
  // Si el middleware bloquea antes con 403 ACCOUNT_BLOCKED, distinguimos.
  if (r.status === 400 && r.body.code === 'ACCOUNT_ALREADY_INACTIVE'
      && r.body.error === 'Esta cuenta ya está desactivada.') return;
  // Fallback: el middleware bloqueó antes con 403 — interpretamos como FAIL si no es exactamente lo del contrato.
  throw new Error(`status=${r.status} code=${r.body?.code} err=${r.body?.error}`);
}

async function T432() {
  const { user, business } = await createBusiness('t432', { plan: 'premium', subStatus: 'active' });
  const r = await agent()
    .post('/api/account/delete')
    .set('Authorization', `Bearer ${user.access_token}`);
  if (r.status !== 400) throw new Error(`status ${r.status} body=${JSON.stringify(r.body)}`);
  if (r.body.code !== 'ACTIVE_SUBSCRIPTION') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== 'Cancela tu suscripción Premium antes de eliminar tu cuenta.') {
    throw new Error(`msg=${r.body.error}`);
  }
}

async function T433() {
  const u = await createConsumer('t433');
  const code = await plantDeletionCode(u.id, u.email, '123456', 30);
  const r = await agent()
    .post('/api/account/delete/confirm')
    .set('Authorization', `Bearer ${u.access_token}`)
    .send({ code });
  if (r.status !== 200) throw new Error(`status ${r.status} body=${JSON.stringify(r.body)}`);
  if (r.body.data.account_deleted !== true) throw new Error('flag false');
  const db = await query(`SELECT is_active, push_token FROM users WHERE id=$1`, [u.id]);
  if (db.rows[0].is_active !== false) throw new Error('is_active != false');
  if (db.rows[0].push_token !== null) throw new Error('push_token != null');
  // Login posterior
  const login = await agent()
    .post('/api/auth/login')
    .send({ email: u.email, password: 'password1' });
  if (login.status !== 403) throw new Error(`login status=${login.status}`);
  if (login.body.code !== 'ACCOUNT_BLOCKED') throw new Error(`login code=${login.body.code}`);
}

async function T434() {
  const { user, business } = await createBusiness('t434', { plan: 'free' });
  // 3 cupones activos
  const ids = [];
  for (let i = 0; i < 3; i++) {
    ids.push(await createCouponDirect(business.id, { title: `c${i}` }));
  }
  const code = await plantDeletionCode(user.id, user.email, '654321', 30);
  const r = await agent()
    .post('/api/account/delete/confirm')
    .set('Authorization', `Bearer ${user.access_token}`)
    .send({ code });
  if (r.status !== 200) throw new Error(`status ${r.status} body=${JSON.stringify(r.body)}`);
  const u = await query(`SELECT is_active FROM users WHERE id=$1`, [user.id]);
  if (u.rows[0].is_active !== false) throw new Error('user.is_active != false');
  const b = await query(`SELECT status FROM businesses WHERE id=$1`, [business.id]);
  if (b.rows[0].status !== 'suspended') throw new Error(`biz.status=${b.rows[0].status}`);
  const c = await query(`SELECT status FROM coupons WHERE id = ANY($1::int[])`, [ids]);
  for (const row of c.rows) {
    if (row.status !== 'expired') throw new Error(`coupon.status=${row.status}`);
  }
  const log = await query(
    `SELECT id FROM activity_logs WHERE user_id=$1 AND action='account_deleted'`,
    [user.id]
  );
  if (log.rowCount === 0) throw new Error('activity_log faltante');
}

async function T435() {
  const u = await createConsumer('t435');
  const r = await agent()
    .post('/api/account/delete/confirm')
    .set('Authorization', `Bearer ${u.access_token}`)
    .send({ code: '000000' });
  if (r.status !== 400) throw new Error(`status ${r.status}`);
  if (r.body.code !== 'INVALID_CODE') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== 'Código incorrecto.') throw new Error(`msg=${r.body.error}`);
}

async function T436() {
  const u = await createConsumer('t436');
  // Plant code expired (-1 minute)
  const code = '123456';
  const codeHash = sha256(code);
  await query(
    `INSERT INTO email_verification_tokens (user_id, email, code_hash, expires_at)
     VALUES ($1, $2, $3, NOW() - INTERVAL '1 minute')`,
    [u.id, u.email, codeHash]
  );
  const r = await agent()
    .post('/api/account/delete/confirm')
    .set('Authorization', `Bearer ${u.access_token}`)
    .send({ code });
  if (r.status !== 400) throw new Error(`status ${r.status}`);
  if (r.body.code !== 'CODE_EXPIRED') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== 'El código ha expirado. Solicita la eliminación de nuevo.') {
    throw new Error(`msg=${r.body.error}`);
  }
}

// ────────────────────────────────────────────────────────────
// EXPORTACIÓN PDF
// ────────────────────────────────────────────────────────────
async function T440() {
  const { user, business } = await createBusiness('t440', { plan: 'premium' });
  const r = await agent()
    .post('/api/exports/pdf')
    .set('Authorization', `Bearer ${user.access_token}`)
    .send({ type: 'coupons_report', date_from: '2026-04-01', date_to: '2026-04-28' });
  if (r.status !== 202) throw new Error(`status ${r.status} body=${JSON.stringify(r.body)}`);
  if (r.body.data.status !== 'pending') throw new Error(`status=${r.body.data.status}`);
  const db = await query(
    `SELECT status FROM exports WHERE id=$1 AND business_id=$2`,
    [r.body.data.export_id, business.id]
  );
  if (db.rowCount === 0) throw new Error('export no insertado');
  // Esperar al job
  await exportsSvc._awaitAllJobs();
}

async function T441() {
  const { user } = await createBusiness('t441', { plan: 'premium' });
  const r = await agent()
    .post('/api/exports/pdf')
    .set('Authorization', `Bearer ${user.access_token}`)
    .send({ type: 'invalid_type' });
  if (r.status !== 400) throw new Error(`status ${r.status}`);
  if (r.body.code !== 'VALIDATION_ERROR') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== 'Tipo de exportación inválido.') throw new Error(`msg=${r.body.error}`);
}

async function T442() {
  const { user } = await createBusiness('t442', { plan: 'premium' });
  const r = await agent()
    .post('/api/exports/pdf')
    .set('Authorization', `Bearer ${user.access_token}`)
    .send({ type: 'coupons_report', date_from: '2026-05-01', date_to: '2026-04-01' });
  if (r.status !== 400) throw new Error(`status ${r.status}`);
  if (r.body.code !== 'VALIDATION_ERROR') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== 'La fecha final debe ser posterior a la fecha inicial.') {
    throw new Error(`msg=${r.body.error}`);
  }
}

async function T443() {
  const { user, business } = await createBusiness('t443', { plan: 'premium' });
  // Plantar export 'processing' directo
  await query(
    `INSERT INTO exports (business_id, user_id, type, status)
     VALUES ($1, $2, 'coupons_report', 'processing')`,
    [business.id, user.id]
  );
  const r = await agent()
    .post('/api/exports/pdf')
    .set('Authorization', `Bearer ${user.access_token}`)
    .send({ type: 'coupons_report' });
  if (r.status !== 429) throw new Error(`status ${r.status}`);
  if (r.body.code !== 'EXPORT_IN_PROGRESS') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== 'Ya tienes una exportación en proceso. Espera a que termine.') {
    throw new Error(`msg=${r.body.error}`);
  }
}

async function T444() {
  const { user } = await createBusiness('t444', { plan: 'free' });
  const r = await agent()
    .post('/api/exports/pdf')
    .set('Authorization', `Bearer ${user.access_token}`)
    .send({ type: 'coupons_report' });
  if (r.status !== 403) throw new Error(`status ${r.status}`);
  if (r.body.code !== 'PLAN_RESTRICTED') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== 'La exportación de reportes está disponible en el plan Premium.') {
    throw new Error(`msg=${r.body.error}`);
  }
}

async function T445() {
  const { user, business } = await createBusiness('t445', { plan: 'premium' });
  // Plantar export completed
  const ins = await query(
    `INSERT INTO exports (business_id, user_id, type, status, file_url, expires_at, completed_at)
     VALUES ($1, $2, 'coupons_report', 'completed', $3, NOW() + INTERVAL '24 hours', NOW())
     RETURNING id`,
    [business.id, user.id, `https://mock.cuponiko.storage/exports-pdf/${business.id}/x.pdf`]
  );
  const r = await agent()
    .get(`/api/exports/${ins.rows[0].id}`)
    .set('Authorization', `Bearer ${user.access_token}`);
  if (r.status !== 200) throw new Error(`status ${r.status} body=${JSON.stringify(r.body)}`);
  if (r.body.data.status !== 'completed') throw new Error(`status=${r.body.data.status}`);
  if (!r.body.data.file_url) throw new Error('file_url vacío');
  if (!r.body.data.expires_at) throw new Error('expires_at faltante');
}

async function T446() {
  const a = await createBusiness('t446a', { plan: 'premium' });
  const b = await createBusiness('t446b', { plan: 'premium' });
  const ins = await query(
    `INSERT INTO exports (business_id, user_id, type, status)
     VALUES ($1, $2, 'coupons_report', 'pending')
     RETURNING id`,
    [a.business.id, a.user.id]
  );
  const r = await agent()
    .get(`/api/exports/${ins.rows[0].id}`)
    .set('Authorization', `Bearer ${b.user.access_token}`);
  if (r.status !== 403) throw new Error(`status ${r.status}`);
  if (r.body.code !== 'FORBIDDEN') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== 'No tienes permiso para ver esta exportación.') {
    throw new Error(`msg=${r.body.error}`);
  }
}

// ────────────────────────────────────────────────────────────
// PERFILES PÚBLICOS
// ────────────────────────────────────────────────────────────
async function T450() {
  const { business } = await createBusiness('t450', { plan: 'premium' });
  // 5 cupones activos
  for (let i = 0; i < 5; i++) await createCouponDirect(business.id, { title: `c${i}` });
  // loyalty card activa
  await query(
    `INSERT INTO loyalty_cards (business_id, name, reward_description, stamps_required, is_active)
     VALUES ($1, $2, 'reward', 5, TRUE)`,
    [business.id, `${PREFIX}lc-t450`]
  );
  const r = await agent().get(`/api/businesses/${business.id}/public`);
  if (r.status !== 200) throw new Error(`status ${r.status} body=${JSON.stringify(r.body)}`);
  if (!r.body.data.business_name) throw new Error('business_name faltante');
  if (r.body.data.active_coupons_count !== 5) throw new Error(`coupons=${r.body.data.active_coupons_count}`);
  if (r.body.data.has_loyalty_program !== true) throw new Error('has_loyalty_program != true');
  if ('stripe_customer_id' in r.body.data || 'stripe_subscription_id' in r.body.data) {
    throw new Error('stripe_* expuesto');
  }
}

async function T451() {
  const { business } = await createBusiness('t451', { plan: 'free', status: 'suspended' });
  const r = await agent().get(`/api/businesses/${business.id}/public`);
  if (r.status !== 404) throw new Error(`status ${r.status}`);
  if (r.body.code !== 'NOT_FOUND') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== 'Negocio no encontrado.') throw new Error(`msg=${r.body.error}`);
}

async function T452() {
  const r = await agent().get('/api/businesses/99999999/public');
  if (r.status !== 404) throw new Error(`status ${r.status}`);
  if (r.body.code !== 'NOT_FOUND') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== 'Negocio no encontrado.') throw new Error(`msg=${r.body.error}`);
}

async function T453() {
  const { business } = await createBusiness('t453', { plan: 'free' });
  const cid = await createCouponDirect(business.id, { title: 'pub', total: 100, uses: 15 });
  const r = await agent().get(`/api/coupons/${cid}/public`);
  if (r.status !== 200) throw new Error(`status ${r.status} body=${JSON.stringify(r.body)}`);
  if (r.body.data.remaining_uses !== 85) throw new Error(`remaining=${r.body.data.remaining_uses}`);
  if ('uses_count' in r.body.data) throw new Error('uses_count expuesto');
  if (!r.body.data.business?.business_name) throw new Error('biz.name faltante');
}

async function T454() {
  const { business } = await createBusiness('t454', { plan: 'free' });
  const cid = await createCouponDirect(business.id, { title: 'exp', endOffsetDays: -1 });
  const r = await agent().get(`/api/coupons/${cid}/public`);
  if (r.status !== 410) throw new Error(`status ${r.status} body=${JSON.stringify(r.body)}`);
  if (r.body.code !== 'COUPON_EXPIRED') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== 'Este cupón ya venció.') throw new Error(`msg=${r.body.error}`);
}

async function T455() {
  const r = await agent().get('/api/coupons/99999999/public');
  if (r.status !== 404) throw new Error(`status ${r.status}`);
  if (r.body.code !== 'NOT_FOUND') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== 'Cupón no encontrado.') throw new Error(`msg=${r.body.error}`);
}

// ────────────────────────────────────────────────────────────
// PUSH SEGMENTOS
// ────────────────────────────────────────────────────────────
async function _seedRelatedConsumers(businessId, n = 10, withPushFirst = 5) {
  // Crea n consumers, los relaciona al business via redemptions recientes
  const ids = [];
  for (let i = 0; i < n; i++) {
    const c = await createConsumer(`seg${i}`);
    ids.push(c.id);
    if (i < withPushFirst) {
      await query(`UPDATE users SET push_token=$1 WHERE id=$2`, [`ExpoTok_${runTag}_${c.id}`, c.id]);
    }
    // Crear coupon → instance → redemption
    const couponId = await createCouponDirect(businessId, { title: `seg${i}` });
    const ins = await query(
      `INSERT INTO coupon_instances (coupon_id, consumer_id) VALUES ($1, $2) RETURNING id`,
      [couponId, c.id]
    );
    await query(
      `INSERT INTO redemptions (coupon_instance_id, business_id, consumer_id, redeemed_at, discount_applied)
       VALUES ($1, $2, $3, NOW() - INTERVAL '5 days', 10.00)`,
      [ins.rows[0].id, businessId, c.id]
    );
  }
  return ids;
}

async function T460() {
  const { user, business } = await createBusiness('t460', { plan: 'premium' });
  await _seedRelatedConsumers(business.id, 10, 5);
  const r = await agent()
    .post('/api/notifications/send')
    .set('Authorization', `Bearer ${user.access_token}`)
    .send({ segment: 'all', title: 'Promo especial', body: '20% de descuento hoy' });
  if (r.status !== 202) throw new Error(`status ${r.status} body=${JSON.stringify(r.body)}`);
  if (typeof r.body.data.sent_to !== 'number' || r.body.data.sent_to < 5) {
    throw new Error(`sent_to=${r.body.data.sent_to}`);
  }
  // Validar 10 notifications nuevas
  const cnt = await query(
    `SELECT COUNT(*)::int n FROM notifications
      WHERE type='business_broadcast' AND title=$1
        AND created_at > NOW() - INTERVAL '5 minutes'`,
    ['Promo especial']
  );
  if (cnt.rows[0].n < 10) throw new Error(`notifications inserted=${cnt.rows[0].n}`);
  const log = await query(
    `SELECT id FROM activity_logs
      WHERE business_id=$1 AND action='notification_sent'
      ORDER BY created_at DESC LIMIT 1`,
    [business.id]
  );
  if (log.rowCount === 0) throw new Error('activity_log faltante');
}

async function T461() {
  const { user } = await createBusiness('t461', { plan: 'free' });
  const r = await agent()
    .post('/api/notifications/send')
    .set('Authorization', `Bearer ${user.access_token}`)
    .send({ segment: 'all', title: 'Test', body: 'Test' });
  if (r.status !== 403) throw new Error(`status ${r.status}`);
  if (r.body.code !== 'PLAN_RESTRICTED') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== 'El envío de notificaciones está disponible en el plan Premium.') {
    throw new Error(`msg=${r.body.error}`);
  }
}

async function T462() {
  const { user } = await createBusiness('t462', { plan: 'premium' });
  const r = await agent()
    .post('/api/notifications/send')
    .set('Authorization', `Bearer ${user.access_token}`)
    .send({ segment: 'vip', title: 'Test', body: 'Test' });
  if (r.status !== 400) throw new Error(`status ${r.status}`);
  if (r.body.code !== 'VALIDATION_ERROR') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== 'Segmento inválido. Opciones: all, active, inactive, frequent.') {
    throw new Error(`msg=${r.body.error}`);
  }
}

async function T463() {
  const { user } = await createBusiness('t463', { plan: 'premium' });
  const r = await agent()
    .post('/api/notifications/send')
    .set('Authorization', `Bearer ${user.access_token}`)
    .send({ segment: 'all', title: '', body: 'Test' });
  if (r.status !== 400) throw new Error(`status ${r.status}`);
  if (r.body.code !== 'VALIDATION_ERROR') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== 'El título es requerido (máximo 100 caracteres).') {
    throw new Error(`msg=${r.body.error}`);
  }
}

async function T464() {
  const { user, business } = await createBusiness('t464', { plan: 'premium' });
  // Plantar 3 envíos recientes
  for (let i = 0; i < 3; i++) {
    await query(
      `INSERT INTO activity_logs (user_id, business_id, action, metadata, created_at)
       VALUES ($1, $2, 'notification_sent', $3::jsonb, NOW() - INTERVAL '1 hour')`,
      [user.id, business.id, JSON.stringify({ segment: 'all', sent_to: 1 })]
    );
  }
  const r = await agent()
    .post('/api/notifications/send')
    .set('Authorization', `Bearer ${user.access_token}`)
    .send({ segment: 'all', title: 'Cuarta', body: 'Intentando' });
  if (r.status !== 429) throw new Error(`status ${r.status}`);
  if (r.body.code !== 'NOTIFICATION_LIMIT') throw new Error(`code ${r.body.code}`);
  if (r.body.error !== 'Límite de notificaciones alcanzado. Máximo 3 por día.') {
    throw new Error(`msg=${r.body.error}`);
  }
}

// ────────────────────────────────────────────────────────────
// CLEANUP
// ────────────────────────────────────────────────────────────
async function cleanupAll() {
  try {
    // exports primero (FK a businesses/users no cascade)
    await query(`DELETE FROM exports WHERE business_id IN (SELECT id FROM businesses WHERE business_name LIKE $1 || '%')`, [PREFIX]);
    await query(`DELETE FROM redemptions WHERE business_id IN (SELECT id FROM businesses WHERE business_name LIKE $1 || '%')`, [PREFIX]);
    await query(`DELETE FROM coupon_instances WHERE coupon_id IN (SELECT id FROM coupons WHERE title LIKE $1 || '%')`, [PREFIX]);
    await query(`DELETE FROM coupons WHERE title LIKE $1 || '%'`, [PREFIX]);
    await query(`DELETE FROM loyalty_cards WHERE name LIKE $1 || '%'`, [PREFIX]);
    await query(`DELETE FROM users WHERE email LIKE $1 || '%' OR full_name LIKE $1 || '%'`, [PREFIX]);
    await query(`DELETE FROM activity_logs WHERE metadata::text LIKE '%' || $1 || '%'`, [runTag]);
  } catch (err) {
    console.error('[cleanup warn]', err.message);
  }
}

const ALL_TESTS = [
  ['T-400', T400],
  ['T-410', T410],
  ['T-411', T411],
  ['T-412', T412],
  ['T-413', T413],
  ['T-414', T414],
  ['T-415', T415],
  ['T-420', T420],
  ['T-421', T421],
  ['T-422', T422],
  ['T-430', T430],
  ['T-431', T431],
  ['T-432', T432],
  ['T-433', T433],
  ['T-434', T434],
  ['T-435', T435],
  ['T-436', T436],
  ['T-440', T440],
  ['T-441', T441],
  ['T-442', T442],
  ['T-443', T443],
  ['T-444', T444],
  ['T-445', T445],
  ['T-446', T446],
  ['T-450', T450],
  ['T-451', T451],
  ['T-452', T452],
  ['T-453', T453],
  ['T-454', T454],
  ['T-455', T455],
  ['T-460', T460],
  ['T-461', T461],
  ['T-462', T462],
  ['T-463', T463],
  ['T-464', T464],
];

(async () => {
  console.log(`# Cuponiko Fase 3.5 — runTag=${runTag}`);
  for (const [id, fn] of ALL_TESTS) {
    _resetInMemoryBuckets();
    try {
      await fn();
      record(id, true);
    } catch (err) {
      record(id, false, err?.message || String(err));
    }
  }
  await exportsSvc._awaitAllJobs();
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
