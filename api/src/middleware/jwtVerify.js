'use strict';

const { AppError } = require('../utils/AppError');
const { verifyAccessToken } = require('../utils/jwt');

/**
 * Middleware — exige Authorization: Bearer <token>.
 * Extrae user_id (sub) y role al req.user.
 * Falla con 401 AUTH_INVALID si el token es inválido, expirado o ausente.
 */
function jwtVerify(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(401, 'AUTH_INVALID', 'Token inválido o expirado'));
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: Number(payload.sub),
      role: payload.role,
      email: payload.email,
    };
    return next();
  } catch (_err) {
    return next(new AppError(401, 'AUTH_INVALID', 'Token inválido o expirado'));
  }
}

/**
 * Restringe a roles específicos. Usar DESPUÉS de jwtVerify.
 * requireRole('business') | requireRole('business', 'admin')
 */
function requireRole(...roles) {
  return function roleGuard(req, _res, next) {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, 'FORBIDDEN', 'No tienes permisos para esta acción.'));
    }
    return next();
  };
}

module.exports = { jwtVerify, requireRole };
