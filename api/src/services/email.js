'use strict';

/**
 * Servicio de email.
 * v1.0 Fase 1: en modo mock registra el último email enviado en memoria.
 * En producción habría que integrar un proveedor (SES, Resend, SendGrid). Ese
 * trabajo queda para Fase 3 cuando se definan plantillas. Por ahora logueamos
 * y dejamos la puerta abierta.
 */

const env = require('../config/env');
const logger = require('../utils/logger');

const _lastEmail = { to: null, subject: null, body: null, at: null };

function getLastMockEmail() {
  return { ..._lastEmail };
}

function resetLastMockEmail() {
  _lastEmail.to = null;
  _lastEmail.subject = null;
  _lastEmail.body = null;
  _lastEmail.at = null;
}

async function sendEmail(to, subject, body) {
  _lastEmail.to = to;
  _lastEmail.subject = subject;
  _lastEmail.body = body;
  _lastEmail.at = new Date().toISOString();

  if (env.MOCK_EXTERNAL_SERVICES) {
    logger.info('email_mock', { to, subject });
    return { id: 'mock-' + Date.now() };
  }
  // TODO Fase 3: integrar proveedor transaccional (SES / Resend)
  logger.info('email_queued', { to, subject });
  return { id: 'pending-' + Date.now() };
}

async function sendVerificationEmail(to, code) {
  return sendEmail(
    to,
    'Verifica tu correo en Cuponiko',
    `Tu código de verificación es: ${code}\n\nEste código expira en 30 minutos.`
  );
}

async function sendPasswordResetEmail(to, resetUrl) {
  return sendEmail(
    to,
    'Restablece tu contraseña en Cuponiko',
    `Usa este enlace para restablecer tu contraseña: ${resetUrl}\n\nSi no lo solicitaste, ignora este correo.`
  );
}

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  getLastMockEmail,
  resetLastMockEmail,
};
