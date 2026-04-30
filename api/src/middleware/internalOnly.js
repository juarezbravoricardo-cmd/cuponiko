'use strict';

const env = require('../config/env');
const { AppError } = require('../utils/AppError');

/**
 * Protege rutas /internal/* exigiendo header x-internal-secret.
 * Las llamadas legítimas vienen de pg_cron en Supabase.
 */
function internalOnly(req, _res, next) {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== env.INTERNAL_SECRET) {
    return next(new AppError(403, 'FORBIDDEN', 'Forbidden'));
  }
  return next();
}

module.exports = internalOnly;
