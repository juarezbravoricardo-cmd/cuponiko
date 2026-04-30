'use strict';

/**
 * Scanner rate limiter — CPN-07.
 *
 * Analogía: un guardia con libreta. Si un escáner falla 3 veces en 1 minuto,
 * lo manda a la banca 5 minutos. Tras esos 5 minutos, borra la historia.
 *
 * Implementación en memoria (proceso único). Para multi-réplica habría que
 * persistir en Postgres o Redis; para v1.0 (1 réplica en Railway) alcanza.
 *
 * Exporta:
 * - `scannerCooldownGuard(req, res, next)` — middleware a montar ANTES de la
 *   lógica de CPN-07 para cortar con 429 `SCANNER_BLOCKED` si el negocio
 *   está bloqueado.
 * - `registerScanFailure(businessId)` — invocar cada vez que un escaneo falla
 *   con un error de usuario (INVALID_QR, TOKEN_NOT_FOUND, QR_EXPIRED,
 *   ALREADY_REDEEMED, NOT_TRANSFERABLE, COUPON_EXHAUSTED, VALIDATION_ERROR).
 * - `resetScanHistory(businessId)` — tras un escaneo exitoso, limpiar el
 *   contador de fallos del negocio.
 * - `_resetAll()` — solo para tests.
 */

const { AppError } = require('../utils/AppError');
const { query } = require('../config/db');
const logger = require('../utils/logger');

const FAIL_WINDOW_MS = 60 * 1000;      // 1 min de ventana de conteo
const MAX_FAILS = 3;                    // 3 fallos detonan block
const BLOCK_DURATION_MS = 5 * 60 * 1000; // 5 min de bloqueo

/**
 * state[businessId] = {
 *   failures: number[] (timestamps en ms de los fallos dentro de la ventana),
 *   blockedUntil: number | null (timestamp ms)
 * }
 */
const state = new Map();

function getState(businessId) {
  let s = state.get(businessId);
  if (!s) {
    s = { failures: [], blockedUntil: null };
    state.set(businessId, s);
  }
  return s;
}

/**
 * Middleware Express. Asume que ya pasó jwtVerify + requireRole('business')
 * y que existe req.user.id. Resuelve business_id a partir del user_id y lo
 * guarda en req.businessIdForScanner para no volver a consultarlo en el
 * service.
 */
async function scannerCooldownGuard(req, _res, next) {
  try {
    const r = await query('SELECT id FROM businesses WHERE user_id = $1', [req.user.id]);
    if (r.rowCount === 0) {
      return next(new AppError(404, 'BUSINESS_NOT_FOUND', 'Negocio no encontrado.'));
    }
    const businessId = r.rows[0].id;
    req.businessIdForScanner = businessId;

    const s = getState(businessId);
    const now = Date.now();
    if (s.blockedUntil && s.blockedUntil > now) {
      return next(
        new AppError(
          429,
          'SCANNER_BLOCKED',
          'Scanner bloqueado por intentos fallidos. Espera 5 minutos.'
        )
      );
    }
    // Si ya expiró el block, limpiar.
    if (s.blockedUntil && s.blockedUntil <= now) {
      s.blockedUntil = null;
      s.failures = [];
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Llamar cuando un escaneo falla. Si suma 3 fallos en la ventana, activa
 * el bloqueo y loggea `scanner_rate_limit_triggered` en activity_logs.
 */
async function registerScanFailure(businessId) {
  const s = getState(businessId);
  const now = Date.now();
  // Purgar fallos fuera de la ventana
  s.failures = s.failures.filter((t) => t > now - FAIL_WINDOW_MS);
  s.failures.push(now);
  if (s.failures.length >= MAX_FAILS && !s.blockedUntil) {
    s.blockedUntil = now + BLOCK_DURATION_MS;
    try {
      await query(
        `INSERT INTO activity_logs (business_id, action, metadata)
         VALUES ($1, 'scanner_rate_limit_triggered', $2::jsonb)`,
        [businessId, JSON.stringify({ fails: s.failures.length })]
      );
    } catch (err) {
      logger.error('scanner_ratelimit_log_failed', { message: err.message });
    }
    // T-321: si en la última hora hubo ≥3 bloqueos, generar alerta antifraude
    try {
      const r = await query(
        `SELECT COUNT(*)::int AS n FROM activity_logs
           WHERE business_id = $1
             AND action = 'scanner_rate_limit_triggered'
             AND created_at > NOW() - INTERVAL '1 hour'`,
        [businessId]
      );
      if (r.rows[0].n >= 3) {
        await query(
          `INSERT INTO alerts (type, severity, description, business_id)
           VALUES ('rate_limit_repeat', 'medium', $1, $2)`,
          [
            `Scanner del negocio ${businessId} alcanzó ${r.rows[0].n} bloqueos en la última hora.`,
            businessId,
          ]
        );
      }
    } catch (err) {
      logger.error('rate_limit_repeat_alert_failed', { message: err.message });
    }
  }
}

/**
 * Tras un escaneo exitoso, reiniciar el conteo (no tiene sentido mantener
 * strikes pasados si el escáner vuelve a funcionar).
 */
function resetScanHistory(businessId) {
  const s = state.get(businessId);
  if (s) {
    s.failures = [];
    s.blockedUntil = null;
  }
}

function _resetAll() {
  state.clear();
}

// Limpieza periódica para evitar leaks
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of state) {
    if ((!s.blockedUntil || s.blockedUntil <= now) && s.failures.every((t) => t <= now - FAIL_WINDOW_MS)) {
      state.delete(id);
    }
  }
}, 10 * 60 * 1000).unref?.();

module.exports = {
  scannerCooldownGuard,
  registerScanFailure,
  resetScanHistory,
  _resetAll,
};
