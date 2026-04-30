#!/usr/bin/env node
'use strict';

/**
 * Runner autónomo de tests de aceptación para Fase 1.
 *
 * - No depende de jest/mocha — imprime `T-XXX: PASS` o `T-XXX: FAIL: motivo`
 *   exactamente como pide la directriz "Instrucciones para el agente" de
 *   cuponiko_tests_aceptacion_v1.md.
 * - Usa supertest contra la app Express in-process (no abre puerto).
 * - Cada test se aísla con un prefijo único (`runTag`) en los emails/teléfonos
 *   que crea, y limpia su propio estado con `cleanupByEmailPrefix`.
 *
 * Requisitos: NODE_ENV=test y MOCK_EXTERNAL_SERVICES=true en env.
 */

process.env.NODE_ENV = 'test';
process.env.MOCK_EXTERNAL_SERVICES = 'true';

require('dotenv').config();

const request = require('supertest');
const crypto = require('crypto');
const { buildApp } = require('../src/app');
const { pool, query } = require('../src/config/db');
const { sha256, hashPassword } = require('../src/utils/hash');
const { signAccessToken } = require('../src/utils/jwt');

const app = buildApp();
const agent = () => request(app);

const runTag = `phase1_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
const PREFIX = `t1_${runTag}_`;

const results = [];
function record(id, ok, motivo) {
  results.push({ id, ok, motivo });
  const tag = ok ? 'PASS' : 'FAIL';
  const msg = ok ? '' : `: ${motivo}`;
  // eslint-disable-next-line no-console
  console.log(`${id}: ${tag}${msg}`);
}

// ────────────────────────────────────────────────────────────
// Helpers de datos
// ────────────────────────────────────────────────────────────
function uniq(suffix = '') {
  return `${PREFIX}${Math.random().toString(36).slice(2, 8)}${suffix}`;
}

function uniqEmail(label = '') {
  return `${uniq(label)}@mail.test`;
}

function uniqPhone() {
  // +521 + 10 dígitos aleatorios, únicos
  const n = crypto.randomInt(1000000000, 9999999999);
  return `+521${String(n)}`.slice(0, 14);
}

async function cleanupAll() {
  try {
    await query(
      `DELETE FROM users WHERE email LIKE $1 || '%' OR full_name LIKE $1 || '%'`,
      [PREFIX]
    );
    await query(
      `DELETE FROM activity_logs WHERE metadata::text LIKE '%' || $1 || '%'`,
      [runTag]
    );
    await query(
      `DELETE FROM stripe_events WHERE stripe_event_id LIKE 'evt_' || $1 || '%'`,
      [runTag]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[cleanup warn]', err.message);
  }
}

// ────────────────────────────────────────────────────────────
// Primitivas para crear fixtures sin tocar el endpoint
// ────────────────────────────────────────────────────────────
async function createUserDirect({
  email,
  password = 'secure1234',
  role = 'consumer',
  full_name = 'Test',
  email_verified = true,
  phone_verified = true,
  is_active = true,
  phone = null,
  google_id = null,
}) {
  const hash = await hashPassword(password);
  const r = await query(
    `INSERT INTO users (email, password_hash, full_name, phone, role, is_active,
                        email_verified, phone_verified, google_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, email, role`,
    [email, hash, full_name, phone, role, is_active, email_verified, phone_verified, google_id]
  );
  return r.rows[0];
}

async function createBusinessDirect({
  userId,
  plan = 'free',
  stripeCustomerId = null,
  stripeSubscriptionId = null,
}) {
  const r = await query(
    `INSERT INTO businesses
      (user_id, business_name, category, lat, lng, display_address, location,
       plan, status, stripe_customer_id, stripe_subscription_id)
     VALUES ($1,$2,$3,$4::double precision,$5::double precision,$6,
             ST_SetSRID(ST_MakePoint($5::double precision, $4::double precision), 4326)::geography,
             $7, 'active', $8, $9)
     RETURNING id`,
    [
      userId,
      `${PREFIX}biz`,
      'taqueria',
      19.4326,
      -99.1332,
      'Zócalo, CDMX',
      plan,
      stripeCustomerId,
      stripeSubscriptionId,
    ]
  );
  return r.rows[0];
}

async function createCouponDirect({ businessId, status = 'active', createdAt = null }) {
  const r = await query(
    `INSERT INTO coupons
       (business_id, title, discount_type, discount_value, start_date, end_date,
        usage_limit_per_user, total_usage_limit, uses_count, transferable,
        accumulable, max_accumulated_discount, max_coupons_per_tx, single_use,
        is_ad_exclusive, status, created_at)
     VALUES ($1,$2,'percent',20,CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days',
             1, 100, 0, FALSE, FALSE, 70, 2, TRUE, FALSE, $3, COALESCE($4::timestamptz, NOW()))
     RETURNING id, created_at`,
    [businessId, `${PREFIX}cpn_${crypto.randomBytes(3).toString('hex')}`, status, createdAt]
  );
  return r.rows[0];
}

async function resetBusinessRateLimit() {
  const { _resetInMemoryBuckets } = require('../src/middleware/rateLimiter');
  _resetInMemoryBuckets();
  await query(
    `DELETE FROM activity_logs
      WHERE action='business_register_attempt'
        AND created_at > NOW() - INTERVAL '24 hours'`
  );
}

async function assertEq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: esperado ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
  }
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

async function T100() {
  const email = uniqEmail('_100');
  const res = await agent()
    .post('/api/auth/register')
    .send({ email, password: 'secure1234', full_name: 'Test T-100' });
  await assertEq(res.status, 201, 'HTTP status');
  if (!res.body?.data?.user_id) throw new Error('user_id ausente');
  if (res.body.data.email_verified !== false) throw new Error('email_verified debe ser false');
  const db = await query('SELECT role, email_verified FROM users WHERE email=$1', [email]);
  if (db.rowCount !== 1) throw new Error('usuario no insertado');
  if (db.rows[0].role !== 'consumer') throw new Error('role != consumer');
  if (db.rows[0].email_verified !== false) throw new Error('email_verified en DB != false');
}

async function T101() {
  const email = uniqEmail('_101');
  // Crear primero
  await createUserDirect({ email, full_name: 'Ya existe', email_verified: false });
  const res = await agent()
    .post('/api/auth/register')
    .send({ email, password: 'otraclave1', full_name: 'Otro T-101' });
  await assertEq(res.status, 409, 'HTTP status');
  await assertEq(res.body?.code, 'EMAIL_EXISTS', 'code');
  await assertEq(
    res.body?.error,
    'Este correo ya está registrado. ¿Quieres iniciar sesión?',
    'mensaje literal'
  );
  const db = await query('SELECT COUNT(*)::int AS n FROM users WHERE email=$1', [email]);
  if (db.rows[0].n !== 1) throw new Error('se creó un segundo registro');
}

async function T102() {
  const email = uniqEmail('_102');
  const res = await agent()
    .post('/api/auth/register')
    .send({ email, password: 'short', full_name: 'Test T-102' });
  await assertEq(res.status, 400, 'HTTP');
  await assertEq(res.body?.code, 'VALIDATION_ERROR', 'code');
  if (!/al menos 8 caracteres y un número/i.test(res.body?.error || '')) {
    throw new Error(`mensaje no contiene frase esperada: ${res.body?.error}`);
  }
}

async function T103() {
  const email = uniqEmail('_103');
  const res = await agent()
    .post('/api/auth/register')
    .send({ email, password: 'onlyletters', full_name: 'Test T-103' });
  await assertEq(res.status, 400, 'HTTP');
  await assertEq(res.body?.code, 'VALIDATION_ERROR', 'code');
}

async function T110() {
  await resetBusinessRateLimit();
  const email = uniqEmail('_110');
  const res = await agent()
    .post('/api/auth/register/business')
    .send({
      full_name: 'Dueño T-110',
      email,
      password: 'secure1234',
      business_name: `${PREFIX}NegocioT110`,
      category: 'taqueria',
      address_input: 'Av. Insurgentes 100, CDMX',
      phone: uniqPhone(),
    });
  await assertEq(res.status, 201, 'HTTP');
  const db = await query(
    `SELECT b.lat, b.lng, b.display_address, b.plan, ST_AsText(b.location) AS wkt
       FROM businesses b JOIN users u ON u.id=b.user_id WHERE u.email=$1`,
    [email]
  );
  if (db.rowCount !== 1) throw new Error('business no insertado');
  const row = db.rows[0];
  if (row.plan !== 'free') throw new Error('plan != free');
  if (row.lat == null || row.lng == null) throw new Error('lat/lng vacíos');
  if (!row.display_address) throw new Error('display_address vacío');
  if (!/^POINT\(/.test(row.wkt || '')) throw new Error(`location WKT inválido: ${row.wkt}`);
}

async function T111() {
  await resetBusinessRateLimit();
  const email = uniqEmail('_111');
  const res = await agent()
    .post('/api/auth/register/business')
    .send({
      full_name: 'Fail T-111',
      email,
      password: 'secure1234',
      business_name: `${PREFIX}NegocioT111`,
      category: 'taqueria',
      address_input: 'xyzinvalido123',
      phone: uniqPhone(),
    });
  await assertEq(res.status, 400, 'HTTP');
  await assertEq(res.body?.code, 'GEOCODING_FAILED', 'code');
  const uDb = await query('SELECT COUNT(*)::int AS n FROM users WHERE email=$1', [email]);
  if (uDb.rows[0].n !== 0) throw new Error('se creó user pese a rollback');
}

async function T112() {
  await resetBusinessRateLimit();
  const phone = uniqPhone();
  const firstEmail = uniqEmail('_112a');
  await createUserDirect({ email: firstEmail, phone, role: 'business', full_name: 'Existente' });
  const res = await agent()
    .post('/api/auth/register/business')
    .send({
      full_name: 'Dup T-112',
      email: uniqEmail('_112b'),
      password: 'secure1234',
      business_name: `${PREFIX}NegocioT112`,
      category: 'taqueria',
      address_input: 'Av. Reforma 1, CDMX',
      phone,
    });
  await assertEq(res.status, 409, 'HTTP');
  await assertEq(res.body?.code, 'PHONE_EXISTS', 'code');
  await assertEq(
    res.body?.error,
    'Este número ya está asociado a otra cuenta.',
    'mensaje literal'
  );
}

async function T113() {
  await resetBusinessRateLimit();

  // Hacer 3 registros exitosos (consumen la cuota). Para aislar usamos direcciones válidas distintas.
  for (let i = 0; i < 3; i++) {
    const r = await agent()
      .post('/api/auth/register/business')
      .send({
        full_name: `T113 #${i}`,
        email: uniqEmail('_113_' + i),
        password: 'secure1234',
        business_name: `${PREFIX}NegT113_${i}`,
        category: 'cafeteria',
        address_input: `Calle ${i} #1, CDMX`,
        phone: uniqPhone(),
      });
    if (r.status !== 201) {
      throw new Error(`Precondición T-113 falló en intento ${i}: ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  // 4to intento desde misma IP → debe caer por rate limit. Usamos el servicio mock Twilio
  // y verificamos que NO se haya enviado SMS capturando el lastMockSms antes/después.
  const { getLastMockSms } = require('../src/services/twilio');
  const snapshotBefore = getLastMockSms();
  const res = await agent()
    .post('/api/auth/register/business')
    .send({
      full_name: 'T113 over',
      email: uniqEmail('_113_over'),
      password: 'secure1234',
      business_name: `${PREFIX}NegT113_over`,
      category: 'taqueria',
      address_input: 'Calle Final, CDMX',
      phone: uniqPhone(),
    });
  await assertEq(res.status, 429, 'HTTP');
  await assertEq(res.body?.code, 'RATE_LIMIT_REGISTER', 'code');
  const snapshotAfter = getLastMockSms();
  // No debió enviarse NUEVO SMS en esta llamada bloqueada
  if (snapshotAfter.at && snapshotAfter.at !== snapshotBefore.at) {
    // Si el at cambió, verificamos que el cuerpo del sms no correspondía al último (habría llegado antes)
    // Toleramos la actualización si ocurrió dentro de T-113 previo (los 3 exitosos).
    // El criterio estricto: no enviar SMS como resultado DE ESTA request. Como
    // el handler corta ANTES del envío (businessRegisterLimiter middleware),
    // snapshotAfter debe ser IDÉNTICO al snapshotBefore.
    throw new Error('Se envió SMS pese al rate limit');
  }
}

async function T120() {
  const email = uniqEmail('_120');
  // Registrar y capturar código
  const r = await agent()
    .post('/api/auth/register')
    .send({ email, password: 'secure1234', full_name: 'T-120' });
  if (r.status !== 201) throw new Error(`precondición: ${r.status} ${JSON.stringify(r.body)}`);
  const code = r.body?.data?._debug_code;
  if (!code) throw new Error('_debug_code ausente (NODE_ENV=test?)');
  const res = await agent().post('/api/auth/verify-email').send({ email, code });
  await assertEq(res.status, 200, 'HTTP');
  const db = await query('SELECT email_verified FROM users WHERE email=$1', [email]);
  if (db.rows[0].email_verified !== true) throw new Error('email_verified no se actualizó');
}

async function T121() {
  const email = uniqEmail('_121');
  const user = await createUserDirect({ email, email_verified: false, full_name: 'T-121' });
  // Insertar token expirado hace 31 minutos
  const code = '123456';
  await query(
    `INSERT INTO email_verification_tokens (user_id, email, code_hash, expires_at)
     VALUES ($1,$2,$3, NOW() - INTERVAL '1 minute')`,
    [user.id, email, sha256(code)]
  );
  const res = await agent().post('/api/auth/verify-email').send({ email, code });
  await assertEq(res.status, 400, 'HTTP');
  await assertEq(res.body?.code, 'CODE_EXPIRED', 'code');
  await assertEq(
    res.body?.error,
    'El código ha expirado. Solicita uno nuevo.',
    'mensaje literal'
  );
}

async function T122() {
  const email = uniqEmail('_122');
  const phone = uniqPhone();
  const user = await createUserDirect({
    email,
    role: 'business',
    phone,
    email_verified: false,
    phone_verified: false,
    full_name: 'T-122',
  });
  // Insertar token con attempts=2
  const code = '654321';
  await query(
    `INSERT INTO phone_verification_tokens (user_id, phone, code_hash, expires_at, attempts)
     VALUES ($1,$2,$3, NOW() + INTERVAL '10 minutes', 2)`,
    [user.id, phone, sha256(code)]
  );
  // Primer intento incorrecto → attempts pasa a 3 y devuelve INVALID_CODE
  const r1 = await agent().post('/api/auth/verify-phone').send({ user_id: user.id, code: '000000' });
  // r1 puede ser 400 INVALID_CODE (el contrato: primero "attempts < 3", pero como attempts==2 pasa la validación).
  if (r1.status !== 400 || r1.body?.code !== 'INVALID_CODE') {
    throw new Error(`precondición r1: ${r1.status} ${JSON.stringify(r1.body)}`);
  }
  // Segundo intento (ahora attempts=3) → MAX_ATTEMPTS con 429
  const r2 = await agent().post('/api/auth/verify-phone').send({ user_id: user.id, code: '000000' });
  await assertEq(r2.status, 429, 'HTTP r2');
  await assertEq(r2.body?.code, 'MAX_ATTEMPTS', 'code');
  await assertEq(
    r2.body?.error,
    'Demasiados intentos. Solicita un nuevo código.',
    'mensaje literal'
  );
  const db = await query(
    `SELECT attempts FROM phone_verification_tokens WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  );
  if (db.rows[0].attempts !== 3) throw new Error(`attempts != 3 (${db.rows[0].attempts})`);
}

async function T130() {
  const email = uniqEmail('_130');
  await createUserDirect({ email, password: 'secure1234', full_name: 'T-130' });
  const res = await agent()
    .post('/api/auth/login')
    .send({ email, password: 'secure1234' });
  await assertEq(res.status, 200, 'HTTP');
  const d = res.body?.data;
  if (!d?.access_token) throw new Error('access_token ausente');
  if (!d?.refresh_token) throw new Error('refresh_token ausente');
  if (!d?.user?.role) throw new Error('user.role ausente');
}

async function T131() {
  const email = uniqEmail('_131');
  await createUserDirect({ email, password: 'secure1234', email_verified: false, full_name: 'T-131' });
  const res = await agent().post('/api/auth/login').send({ email, password: 'secure1234' });
  await assertEq(res.status, 403, 'HTTP');
  await assertEq(res.body?.code, 'EMAIL_NOT_VERIFIED', 'code');
}

async function T132() {
  const email = uniqEmail('_132');
  await createUserDirect({ email, password: 'secure1234', is_active: false, full_name: 'T-132' });
  const res = await agent().post('/api/auth/login').send({ email, password: 'secure1234' });
  await assertEq(res.status, 403, 'HTTP');
  await assertEq(res.body?.code, 'ACCOUNT_BLOCKED', 'code');
  await assertEq(
    res.body?.error,
    'Tu cuenta ha sido suspendida. Contacta soporte.',
    'mensaje literal'
  );
}

async function T133() {
  // Caso 1: email inexistente
  const r1 = await agent().post('/api/auth/login').send({
    email: uniqEmail('_133_nope'),
    password: 'algo1234',
  });
  await assertEq(r1.status, 401, 'HTTP r1');
  await assertEq(r1.body?.error, 'Correo o contraseña incorrectos.', 'mensaje r1');

  // Caso 2: email existente pero password incorrecto
  const email = uniqEmail('_133_ok');
  await createUserDirect({ email, password: 'correctpass1', full_name: 'T-133' });
  const r2 = await agent().post('/api/auth/login').send({ email, password: 'incorrecta1' });
  await assertEq(r2.status, 401, 'HTTP r2');
  await assertEq(r2.body?.error, 'Correo o contraseña incorrectos.', 'mensaje r2');
  // Mismo mensaje y código → no revela existencia
  if (r1.body.error !== r2.body.error) throw new Error('mensajes distintos revelan existencia');
  if (r1.body.code !== r2.body.code) throw new Error('códigos distintos revelan existencia');
}

async function T140() {
  const email = uniqEmail('_140');
  const user = await createUserDirect({ email, password: 'secure1234', full_name: 'T-140' });
  const before = await query(
    'SELECT COUNT(*)::int AS n FROM password_reset_tokens WHERE user_id=$1',
    [user.id]
  );
  const res = await agent().post('/api/auth/forgot-password').send({ email });
  await assertEq(res.status, 200, 'HTTP');
  const after = await query(
    `SELECT COUNT(*)::int AS n, MIN(expires_at) AS first_exp
       FROM password_reset_tokens WHERE user_id=$1`,
    [user.id]
  );
  if (after.rows[0].n !== before.rows[0].n + 1) {
    throw new Error('no se insertó token');
  }
  // expires_at ~ NOW()+1h (tolerancia 2 min)
  const row = await query(
    `SELECT expires_at, created_at,
            EXTRACT(EPOCH FROM (expires_at - created_at))::int AS diff_s
       FROM password_reset_tokens WHERE user_id=$1
       ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  );
  const diff = row.rows[0].diff_s;
  if (Math.abs(diff - 3600) > 120) throw new Error(`expires_at offset anómalo: ${diff}s`);
}

async function T141() {
  const email = uniqEmail('_141');
  const before = await query(
    `SELECT COUNT(*)::int AS n FROM password_reset_tokens
       WHERE user_id IN (SELECT id FROM users WHERE email=$1)`,
    [email]
  );
  const res = await agent().post('/api/auth/forgot-password').send({ email });
  await assertEq(res.status, 200, 'HTTP');
  await assertEq(
    res.body?.data?.message,
    'Si el correo está registrado, recibirás instrucciones para restablecer tu contraseña.',
    'mensaje genérico'
  );
  // No se creó token para email inexistente
  const after = await query(
    `SELECT COUNT(*)::int AS n FROM password_reset_tokens
       WHERE user_id IN (SELECT id FROM users WHERE email=$1)`,
    [email]
  );
  if (after.rows[0].n !== before.rows[0].n) throw new Error('se creó token para email inexistente');
}

async function T142() {
  const email = uniqEmail('_142');
  const user = await createUserDirect({ email, full_name: 'T-142' });
  const token = crypto.randomBytes(16).toString('base64url');
  const tokenHash = sha256(token);
  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1,$2, NOW() - INTERVAL '1 minute')`,
    [user.id, tokenHash]
  );
  const res = await agent()
    .post('/api/auth/reset-password')
    .send({ token, new_password: 'nueva1234' });
  await assertEq(res.status, 400, 'HTTP');
  await assertEq(
    res.body?.error,
    'Este enlace ya no es válido. Solicita uno nuevo.',
    'mensaje literal'
  );
}

async function T143() {
  const email = uniqEmail('_143');
  const user = await createUserDirect({ email, full_name: 'T-143' });
  const token = crypto.randomBytes(16).toString('base64url');
  const tokenHash = sha256(token);
  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used)
     VALUES ($1,$2, NOW() + INTERVAL '1 hour', TRUE)`,
    [user.id, tokenHash]
  );
  const res = await agent()
    .post('/api/auth/reset-password')
    .send({ token, new_password: 'nueva1234' });
  await assertEq(res.status, 400, 'HTTP');
  await assertEq(res.body?.error, 'Este enlace ya fue utilizado.', 'mensaje literal');
}

// ────────────────────────────────────────────────────────────
// Stripe webhooks (BILL-02) — usando mock de Stripe
// ────────────────────────────────────────────────────────────
async function T150() {
  const email = uniqEmail('_150');
  const user = await createUserDirect({ email, role: 'business', phone: uniqPhone(), full_name: 'T-150' });
  const biz = await createBusinessDirect({
    userId: user.id,
    plan: 'free',
    stripeCustomerId: `cus_${runTag}_150`,
  });
  const eventId = `evt_${runTag}_150`;
  const payload = {
    id: eventId,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_${runTag}_150`,
        subscription: `sub_${runTag}_150`,
        customer: `cus_${runTag}_150`,
        metadata: { business_id: String(biz.id) },
      },
    },
  };
  const res = await agent()
    .post('/api/webhooks/stripe')
    .set('stripe-signature', 'mock-sig-ok')
    .set('content-type', 'text/plain')
    .send(JSON.stringify(payload));
  await assertEq(res.status, 200, 'HTTP');
  const db = await query(
    'SELECT plan, subscription_status FROM businesses WHERE id=$1',
    [biz.id]
  );
  if (db.rows[0].plan !== 'premium') throw new Error(`plan != premium: ${db.rows[0].plan}`);
  if (db.rows[0].subscription_status !== 'active') {
    throw new Error(`subscription_status != active: ${db.rows[0].subscription_status}`);
  }
  const ev = await query('SELECT 1 FROM stripe_events WHERE stripe_event_id=$1', [eventId]);
  if (ev.rowCount !== 1) throw new Error('stripe_events no tiene el registro');
}

async function T151() {
  const email = uniqEmail('_151');
  const user = await createUserDirect({ email, role: 'business', phone: uniqPhone(), full_name: 'T-151' });
  const biz = await createBusinessDirect({
    userId: user.id,
    plan: 'free',
    stripeCustomerId: `cus_${runTag}_151`,
  });
  const eventId = `evt_${runTag}_151`;
  // Primer envío: marca premium
  const payload = {
    id: eventId,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_${runTag}_151`,
        subscription: `sub_${runTag}_151`,
        customer: `cus_${runTag}_151`,
        metadata: { business_id: String(biz.id) },
      },
    },
  };
  const r1 = await agent()
    .post('/api/webhooks/stripe')
    .set('stripe-signature', 'mock-sig-ok')
    .set('content-type', 'text/plain')
    .send(JSON.stringify(payload));
  await assertEq(r1.status, 200, 'HTTP r1');
  // Ahora manualmente bajamos a 'free' para detectar si el 2º envío re-procesa.
  await query(`UPDATE businesses SET plan='free' WHERE id=$1`, [biz.id]);

  const r2 = await agent()
    .post('/api/webhooks/stripe')
    .set('stripe-signature', 'mock-sig-ok')
    .set('content-type', 'text/plain')
    .send(JSON.stringify(payload));
  await assertEq(r2.status, 200, 'HTTP r2');
  if (r2.body?.duplicate !== true) throw new Error('respuesta no indica duplicate');
  const db = await query('SELECT plan FROM businesses WHERE id=$1', [biz.id]);
  if (db.rows[0].plan !== 'free') throw new Error('plan cambió pese a duplicado');
  const ev = await query(
    `SELECT COUNT(*)::int AS n FROM stripe_events WHERE stripe_event_id=$1`,
    [eventId]
  );
  if (ev.rows[0].n !== 1) throw new Error(`stripe_events tiene ${ev.rows[0].n} registros (debe ser 1)`);
}

async function T152() {
  const email = uniqEmail('_152');
  const user = await createUserDirect({
    email, role: 'business', phone: uniqPhone(), full_name: 'T-152',
  });
  const biz = await createBusinessDirect({
    userId: user.id,
    plan: 'premium',
    stripeCustomerId: `cus_${runTag}_152`,
    stripeSubscriptionId: `sub_${runTag}_152`,
  });
  // Crear 5 cupones activos con created_at escalonado (A más viejo ... E más nuevo)
  const ids = {};
  for (const [label, offsetMinutes] of [
    ['A', -50],
    ['B', -40],
    ['C', -30],
    ['D', -20],
    ['E', -10],
  ]) {
    const r = await query(
      `INSERT INTO coupons
         (business_id, title, discount_type, discount_value, start_date, end_date,
          usage_limit_per_user, total_usage_limit, uses_count, transferable, accumulable,
          max_accumulated_discount, max_coupons_per_tx, single_use, is_ad_exclusive,
          status, created_at)
       VALUES ($1, $2, 'percent', 20, CURRENT_DATE, CURRENT_DATE + 30,
               1, 100, 0, FALSE, FALSE, 70, 2, TRUE, FALSE,
               'active', NOW() + ($3 || ' minutes')::interval)
       RETURNING id`,
      [biz.id, `${PREFIX}cpn_${label}`, offsetMinutes]
    );
    ids[label] = r.rows[0].id;
  }

  const eventId = `evt_${runTag}_152`;
  const payload = {
    id: eventId,
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: `sub_${runTag}_152`,
        customer: `cus_${runTag}_152`,
        metadata: { business_id: String(biz.id) },
      },
    },
  };
  const res = await agent()
    .post('/api/webhooks/stripe')
    .set('stripe-signature', 'mock-sig-ok')
    .set('content-type', 'text/plain')
    .send(JSON.stringify(payload));
  await assertEq(res.status, 200, 'HTTP');
  const row = await query('SELECT plan FROM businesses WHERE id=$1', [biz.id]);
  if (row.rows[0].plan !== 'free') throw new Error('plan no bajó a free');
  const statuses = await query(
    `SELECT id, status FROM coupons WHERE id = ANY($1::bigint[]) ORDER BY created_at ASC`,
    [[ids.A, ids.B, ids.C, ids.D, ids.E]]
  );
  const byId = Object.fromEntries(statuses.rows.map((r) => [r.id, r.status]));
  const expected = {
    [ids.A]: 'active',
    [ids.B]: 'active',
    [ids.C]: 'active',
    [ids.D]: 'paused_by_downgrade',
    [ids.E]: 'paused_by_downgrade',
  };
  for (const [id, wanted] of Object.entries(expected)) {
    if (byId[id] !== wanted) {
      throw new Error(`cupón ${id} status=${byId[id]} (esperado ${wanted})`);
    }
  }
}

async function T153() {
  const email = uniqEmail('_153');
  const user = await createUserDirect({
    email, role: 'business', phone: uniqPhone(), full_name: 'T-153',
  });
  const biz = await createBusinessDirect({
    userId: user.id,
    plan: 'premium',
    stripeCustomerId: `cus_${runTag}_153`,
    stripeSubscriptionId: `sub_${runTag}_153`,
  });
  const c1 = await createCouponDirect({ businessId: biz.id });
  const c2 = await createCouponDirect({ businessId: biz.id });

  const eventId = `evt_${runTag}_153`;
  const payload = {
    id: eventId,
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: `sub_${runTag}_153`,
        customer: `cus_${runTag}_153`,
        metadata: { business_id: String(biz.id) },
      },
    },
  };
  const res = await agent()
    .post('/api/webhooks/stripe')
    .set('stripe-signature', 'mock-sig-ok')
    .set('content-type', 'text/plain')
    .send(JSON.stringify(payload));
  await assertEq(res.status, 200, 'HTTP');
  const row = await query('SELECT plan FROM businesses WHERE id=$1', [biz.id]);
  if (row.rows[0].plan !== 'free') throw new Error('plan no bajó');
  const st = await query(
    'SELECT status FROM coupons WHERE id = ANY($1::bigint[])',
    [[c1.id, c2.id]]
  );
  for (const r of st.rows) {
    if (r.status !== 'active') throw new Error(`cupón con status ${r.status} (esperado active)`);
  }
}

async function T154() {
  const email = uniqEmail('_154');
  const user = await createUserDirect({
    email, role: 'business', phone: uniqPhone(), full_name: 'T-154',
  });
  const biz = await createBusinessDirect({
    userId: user.id,
    plan: 'free',
    stripeCustomerId: `cus_${runTag}_154`,
  });
  // 2 cupones paused_by_downgrade
  const r1 = await query(
    `INSERT INTO coupons
       (business_id, title, discount_type, discount_value, start_date, end_date,
        usage_limit_per_user, total_usage_limit, uses_count, transferable, accumulable,
        max_accumulated_discount, max_coupons_per_tx, single_use, is_ad_exclusive,
        status, created_at)
     VALUES ($1, $2, 'percent', 10, CURRENT_DATE, CURRENT_DATE + 30,
             1, 100, 0, FALSE, FALSE, 70, 2, TRUE, FALSE,
             'paused_by_downgrade', NOW())
     RETURNING id`,
    [biz.id, `${PREFIX}cpn_p1`]
  );
  const r2 = await query(
    `INSERT INTO coupons
       (business_id, title, discount_type, discount_value, start_date, end_date,
        usage_limit_per_user, total_usage_limit, uses_count, transferable, accumulable,
        max_accumulated_discount, max_coupons_per_tx, single_use, is_ad_exclusive,
        status, created_at)
     VALUES ($1, $2, 'percent', 10, CURRENT_DATE, CURRENT_DATE + 30,
             1, 100, 0, FALSE, FALSE, 70, 2, TRUE, FALSE,
             'paused_by_downgrade', NOW())
     RETURNING id`,
    [biz.id, `${PREFIX}cpn_p2`]
  );

  const eventId = `evt_${runTag}_154`;
  const payload = {
    id: eventId,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_${runTag}_154`,
        subscription: `sub_${runTag}_154`,
        customer: `cus_${runTag}_154`,
        metadata: { business_id: String(biz.id) },
      },
    },
  };
  const res = await agent()
    .post('/api/webhooks/stripe')
    .set('stripe-signature', 'mock-sig-ok')
    .set('content-type', 'text/plain')
    .send(JSON.stringify(payload));
  await assertEq(res.status, 200, 'HTTP');
  const row = await query('SELECT plan FROM businesses WHERE id=$1', [biz.id]);
  if (row.rows[0].plan !== 'premium') throw new Error('plan != premium');
  const st = await query(
    'SELECT status FROM coupons WHERE id = ANY($1::bigint[])',
    [[r1.rows[0].id, r2.rows[0].id]]
  );
  for (const r of st.rows) {
    if (r.status !== 'active') throw new Error(`cupón status ${r.status} (esperado active)`);
  }
}

// ────────────────────────────────────────────────────────────
// Orquestación
// ────────────────────────────────────────────────────────────
const ALL_TESTS = [
  ['T-100', T100],
  ['T-101', T101],
  ['T-102', T102],
  ['T-103', T103],
  ['T-110', T110],
  ['T-111', T111],
  ['T-112', T112],
  ['T-113', T113],
  ['T-120', T120],
  ['T-121', T121],
  ['T-122', T122],
  ['T-130', T130],
  ['T-131', T131],
  ['T-132', T132],
  ['T-133', T133],
  ['T-140', T140],
  ['T-141', T141],
  ['T-142', T142],
  ['T-143', T143],
  ['T-150', T150],
  ['T-151', T151],
  ['T-152', T152],
  ['T-153', T153],
  ['T-154', T154],
];

(async () => {
  // eslint-disable-next-line no-console
  console.log(`# Cuponiko Fase 1 — runTag=${runTag}`);
  for (const [id, fn] of ALL_TESTS) {
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
    console.log('Fallidos:', failed.map((r) => r.id).join(', '));
  }
  await pool.end();
  process.exit(failed.length ? 1 : 0);
})();
