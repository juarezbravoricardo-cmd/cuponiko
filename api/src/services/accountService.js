'use strict';

/**
 * accountService — implementa ACCT-01 y ACCT-02 de cuponiko_contratos_api_v2.md
 *
 * Analogía: dar de baja a un usuario es como cancelar una membresía del gym.
 * Primero confirmas que de verdad fue él (código por correo, 30 min), después
 * desactivas su tarjeta (is_active=false), apagas el lector de huella
 * (push_token=NULL) y, si era dueño de un local, también cierras el local
 * y caducas todas las promociones. Todo en una sola operación atómica para
 * que no quede el local abierto si la cuenta del dueño ya está cerrada.
 *
 * Reglas críticas honradas:
 *  - AP-03: la cascada (users + businesses + coupons + activity_log) corre
 *    dentro de withTransaction → ROLLBACK total ante cualquier fallo.
 *  - AP-01: el UPDATE de email_verification_tokens es atómico WHERE+RETURNING
 *    para marcar `used` sin doble canje.
 *  - Borrado LÓGICO: el email queda ocupado (no se puede re-registrar).
 */

const { query, withTransaction } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { sha256, generateNumericCode } = require('../utils/hash');
const { sendEmail } = require('./email');

const ACTIVE_SUB_STATUSES = new Set(['active', 'trialing', 'past_due']);

// ────────────────────────────────────────────────────────────
// ACCT-01: POST /api/account/delete
// ────────────────────────────────────────────────────────────
async function requestAccountDeletion(userId, { reason } = {}) {
  // 1. Cargar user actual y validar activo
  const u = await query(
    `SELECT id, email, role, is_active FROM users WHERE id = $1`,
    [userId]
  );
  if (u.rowCount === 0 || u.rows[0].is_active === false) {
    throw new AppError(400, 'ACCOUNT_ALREADY_INACTIVE', 'Esta cuenta ya está desactivada.');
  }
  const user = u.rows[0];

  // 2. Si es business con plan premium y suscripción activa, bloquear
  if (user.role === 'business') {
    const b = await query(
      `SELECT plan, subscription_status, stripe_subscription_id
         FROM businesses WHERE user_id = $1`,
      [userId]
    );
    if (b.rowCount > 0) {
      const biz = b.rows[0];
      if (
        biz.plan === 'premium' &&
        biz.subscription_status &&
        ACTIVE_SUB_STATUSES.has(biz.subscription_status)
      ) {
        throw new AppError(
          400,
          'ACTIVE_SUBSCRIPTION',
          'Cancela tu suscripción Premium antes de eliminar tu cuenta.'
        );
      }
    }
  }

  // 3. Generar código 6 dígitos, guardar hash con TTL 30 min
  const code = generateNumericCode(6);
  const codeHash = sha256(code);
  await query(
    `INSERT INTO email_verification_tokens (user_id, email, code_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '30 minutes')`,
    [userId, user.email, codeHash]
  );

  // 4. Email con código
  await sendEmail(
    user.email,
    'Confirma la eliminación de tu cuenta de Cuponiko',
    `Recibimos una solicitud para eliminar tu cuenta.\n\nTu código de confirmación es: ${code}\n\nEste código expira en 30 minutos.\n\nIMPORTANTE: la eliminación es permanente. Si no fuiste tú, ignora este correo.`
  );

  // 5. activity_log
  await query(
    `INSERT INTO activity_logs (user_id, action, metadata)
     VALUES ($1, 'delete_account_requested', $2::jsonb)`,
    [userId, JSON.stringify({ reason: reason || null })]
  );

  return {
    message: 'Te enviamos un código de confirmación a tu correo.',
    expires_in_minutes: 30,
  };
}

// ────────────────────────────────────────────────────────────
// ACCT-02: POST /api/account/delete/confirm
// AP-01 + AP-03: UPDATE atómico del token + cascada en transacción.
// ────────────────────────────────────────────────────────────
async function confirmAccountDeletion(userId, { code }) {
  if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    throw new AppError(400, 'INVALID_CODE', 'Código incorrecto.');
  }
  const codeHash = sha256(code);

  // Marcar token como usado de manera atómica.
  // Distinguimos INVALID_CODE vs CODE_EXPIRED para mensajes correctos.
  const consumed = await query(
    `UPDATE email_verification_tokens
        SET used = true
      WHERE user_id = $1
        AND code_hash = $2
        AND used = false
        AND expires_at > NOW()
      RETURNING id`,
    [userId, codeHash]
  );

  if (consumed.rowCount === 0) {
    // Buscar si hay un código que coincide pero está expirado/usado
    const probe = await query(
      `SELECT used, expires_at
         FROM email_verification_tokens
        WHERE user_id = $1 AND code_hash = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId, codeHash]
    );
    if (probe.rowCount === 0) {
      throw new AppError(400, 'INVALID_CODE', 'Código incorrecto.');
    }
    const t = probe.rows[0];
    if (t.used) {
      throw new AppError(400, 'INVALID_CODE', 'Código incorrecto.');
    }
    if (new Date(t.expires_at).getTime() <= Date.now()) {
      throw new AppError(
        400,
        'CODE_EXPIRED',
        'El código ha expirado. Solicita la eliminación de nuevo.'
      );
    }
    throw new AppError(400, 'INVALID_CODE', 'Código incorrecto.');
  }

  // Cascada en transacción
  await withTransaction(async (client) => {
    // 1. Cargar role del user
    const u = await client.query(`SELECT role FROM users WHERE id = $1`, [userId]);
    if (u.rowCount === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Usuario no encontrado.');
    }
    const role = u.rows[0].role;

    // 2. Desactivar user, limpiar push_token
    await client.query(
      `UPDATE users
          SET is_active = false,
              push_token = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [userId]
    );

    // 3. Si business: suspender negocio y caducar cupones
    if (role === 'business') {
      const biz = await client.query(
        `UPDATE businesses
            SET status = 'suspended',
                updated_at = NOW()
          WHERE user_id = $1
          RETURNING id`,
        [userId]
      );
      if (biz.rowCount > 0) {
        const businessId = biz.rows[0].id;
        await client.query(
          `UPDATE coupons
              SET status = 'expired',
                  updated_at = NOW()
            WHERE business_id = $1
              AND status IN ('active', 'paused', 'paused_by_downgrade')`,
          [businessId]
        );
      }
    }

    // 4. Limpiar tokens activos de verificación restantes
    await client.query(
      `UPDATE email_verification_tokens
          SET used = true
        WHERE user_id = $1 AND used = false`,
      [userId]
    );

    // 5. activity_log
    await client.query(
      `INSERT INTO activity_logs (user_id, action, metadata)
       VALUES ($1, 'account_deleted', $2::jsonb)`,
      [userId, JSON.stringify({ role })]
    );
  });

  return {
    message: 'Tu cuenta ha sido eliminada.',
    account_deleted: true,
  };
}

module.exports = {
  requestAccountDeletion,
  confirmAccountDeletion,
};
