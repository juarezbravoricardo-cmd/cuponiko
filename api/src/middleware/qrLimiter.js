'use strict';

/**
 * Rate limiter de CPN-06 — máximo 10 generaciones de QR por
 * `coupon_instance_id` en una ventana rolling de 1 hora.
 *
 * Analogía: una máquina de tickets en el banco. Si sacaste 10 tickets en la
 * última hora para el mismo trámite, la máquina te dice "ya basta, espera".
 *
 * Se persiste en `activity_logs` con `action = 'qr_generated'` y
 * `metadata.coupon_instance_id`. Así sobrevive reinicios (a diferencia del
 * scannerLimiter que es efímero porque solo necesita resiliencia corta).
 */

const { query } = require('../config/db');
const { AppError } = require('../utils/AppError');

const MAX_PER_HOUR = 10;

/**
 * Middleware que revisa el límite. Debe ir DESPUÉS de jwtVerify y de
 * validar que el :instance_id pertenece al consumer (lo reinforza la lógica
 * del service, pero aquí solo miramos el conteo histórico).
 */
async function qrGenerationLimiter(req, _res, next) {
  try {
    const instanceId = Number(req.params.instance_id);
    if (!Number.isFinite(instanceId)) {
      return next(new AppError(400, 'VALIDATION_ERROR', 'ID inválido.'));
    }
    const r = await query(
      `SELECT COUNT(*)::int AS n
         FROM activity_logs
        WHERE action = 'qr_generated'
          AND (metadata ->> 'coupon_instance_id')::bigint = $1
          AND created_at > NOW() - INTERVAL '1 hour'`,
      [instanceId]
    );
    if (r.rows[0].n >= MAX_PER_HOUR) {
      return next(
        new AppError(
          429,
          'RATE_LIMIT_QR',
          'Demasiadas solicitudes de QR. Intenta en unos minutos.'
        )
      );
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { qrGenerationLimiter, MAX_PER_HOUR };
