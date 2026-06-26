'use strict';

const { AppError } = require('../utils/AppError');
const logger = require('../utils/logger');
const Sentry = require('@sentry/node');

/**
 * Handler global de errores.
 * - AppError → { error, code } con su httpStatus.
 * - Errores de validación joi → 400 VALIDATION_ERROR.
 * - Errores de DB (pg) no capturados → 500 INTERNAL genérico (sin leak).
 * AP-08: NUNCA devolver err.message raw al cliente.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (res.headersSent) return;

  if (err instanceof AppError) {
    return res.status(err.httpStatus).json({
      error: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Joi
  if (err && err.isJoi) {
    const msg = err.details?.[0]?.message || 'Datos inválidos.';
    return res.status(400).json({ error: msg, code: 'VALIDATION_ERROR' });
  }

  // pg constraint violations que hayan escapado
  if (err && err.code && typeof err.code === 'string' && /^2[0-9A-Z]{4}$/.test(err.code)) {
    logger.error('pg_error', { code: err.code, detail: err.detail, constraint: err.constraint });
    return res.status(400).json({
      error: 'Datos inválidos.',
      code: 'VALIDATION_ERROR',
    });
  }

  // Errores de body-parser / http-errors (JSON malformado, payload muy grande,
  // charset no soportado): traen status 4xx + expose=true. Son errores del
  // CLIENTE, no bugs del servidor. Se responden con su status real y NO se
  // reportan a Sentry (evita ruido de bots/scanners con requests malformados).
  const clientStatus = err && (err.status || err.statusCode);
  if (err && err.expose === true && clientStatus >= 400 && clientStatus < 500) {
    const message =
      clientStatus === 413
        ? 'El cuerpo de la solicitud es demasiado grande.'
        : 'Solicitud inválida o mal formada.';
    return res.status(clientStatus).json({ error: message, code: 'BAD_REQUEST' });
  }

  // Reportar a Sentry SOLO los errores no controlados (500 reales = bugs).
  // AppError (4xx), Joi (400) y constraints de pg (400) ya retornaron arriba,
  // así que NO llegan aquí: cero ruido de validación.
  Sentry.captureException(err);

  logger.error('unhandled_error', {
    message: err?.message,
    stack: err?.stack,
    path: req?.originalUrl,
  });
  return res.status(500).json({
    error: 'Ocurrió un error interno. Intenta de nuevo más tarde.',
    code: 'INTERNAL',
  });
}

function notFoundHandler(_req, res) {
  res.status(404).json({ error: 'Ruta no encontrada.', code: 'NOT_FOUND' });
}

module.exports = { errorHandler, notFoundHandler };
