'use strict';

/**
 * Rate limiter en memoria (proceso único).
 *
 * Analogía: un portero que apunta en una hoja quién entra y a qué hora.
 * Si alguien entra más de N veces en una ventana de tiempo, lo bloquea.
 *
 * Para multi-instancia (Railway con ≥2 réplicas) habría que mover esto a
 * Postgres o Redis. Para v1.0 con 1 réplica es suficiente.
 *
 * Además, el rate limit de registro de negocio (`businessRegisterLimiter`)
 * se persiste en `activity_logs` para que sobreviva reinicios (T-113).
 */

const env = require('../config/env');
const { AppError } = require('../utils/AppError');
const { query } = require('../config/db');

// ────────────────────────────────────────────────────────────
// Rate limiter global en memoria (por userId si autenticado, sino por IP)
// ────────────────────────────────────────────────────────────

const globalBuckets = new Map(); // key -> { count, resetAt }

function resolveIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * A4 — Resuelve la key del bucket. Prefiere userId cuando esté disponible
 * (req.user.id seteado por jwtVerify) para no bloquear a varios usuarios
 * detrás de la misma IP NAT/CGNAT (WiFi pública, redes celulares). Fallback
 * a IP cuando el request no está autenticado.
 *
 * Nota: este middleware se monta globalmente ANTES de jwtVerify, por lo que
 * en la práctica casi siempre cae al branch de IP. Queda preparado para si
 * a futuro este limiter se usa también a nivel de router autenticado.
 */
function resolveKey(req) {
  if (req.user && req.user.id) return `u:${req.user.id}`;
  return `ip:${resolveIp(req)}`;
}

function globalLimiter(req, _res, next) {
  const key = resolveKey(req);
  const now = Date.now();
  const windowMs = 60 * 1000;
  const max = env.RATE_LIMIT_GLOBAL_PER_MIN;

  const bucket = globalBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    globalBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return next();
  }
  bucket.count += 1;
  if (bucket.count > max) {
    return next(
      new AppError(429, 'RATE_LIMIT', 'Demasiadas solicitudes. Intenta en un momento.')
    );
  }
  return next();
}

// Limpieza periódica para que el Map no crezca sin control
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of globalBuckets) {
    if (b.resetAt <= now) globalBuckets.delete(k);
  }
}, 5 * 60 * 1000).unref?.();

// ────────────────────────────────────────────────────────────
// Rate limiter de registro de negocio — 3 por IP en 24h
// Persistido en activity_logs con action = 'business_register_attempt'
// ────────────────────────────────────────────────────────────

async function businessRegisterLimiter(req, _res, next) {
  try {
    const ip = resolveIp(req);
    const max = env.RATE_LIMIT_BUSINESS_REGISTER_PER_DAY;
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n
         FROM activity_logs
        WHERE action = 'business_register_attempt'
          AND ip_address = $1::inet
          AND created_at > NOW() - INTERVAL '24 hours'`,
      [ip]
    );
    if (rows[0].n >= max) {
      return next(
        new AppError(
          429,
          'RATE_LIMIT_REGISTER',
          'Demasiados intentos de registro. Intenta en 24 horas.'
        )
      );
    }
    // Registrar intento ANTES de procesar para que incluso fallos cuenten
    await query(
      `INSERT INTO activity_logs (action, ip_address, metadata)
       VALUES ('business_register_attempt', $1::inet, $2::jsonb)`,
      [ip, JSON.stringify({ ua: req.headers['user-agent'] || null })]
    );
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Helper para tests — permite resetear el limiter en memoria entre suites.
 */
function _resetInMemoryBuckets() {
  globalBuckets.clear();
}

module.exports = {
  globalLimiter,
  businessRegisterLimiter,
  resolveIp,
  _resetInMemoryBuckets,
};
