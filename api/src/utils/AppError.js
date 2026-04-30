'use strict';

/**
 * Error de dominio que el errorHandler traduce a { error, code } con HTTP status.
 * Uso: throw new AppError(409, 'EMAIL_EXISTS', 'Este correo ya está registrado...');
 */
class AppError extends Error {
  constructor(httpStatus, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.httpStatus = httpStatus;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }
}

/**
 * Wrapper para handlers async — evita try/catch repetido en cada route.
 */
function asyncHandler(fn) {
  return function asyncRouteHandler(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { AppError, asyncHandler };
