'use strict';

/**
 * Servicio de email.
 *
 * Modos:
 * - MOCK_EXTERNAL_SERVICES=true  → no envía nada, registra el último email en memoria
 *   para inspección en tests (getLastMockEmail / resetLastMockEmail).
 * - MOCK_EXTERNAL_SERVICES=false → envía email real vía Resend usando RESEND_API_KEY.
 *
 * El registro del último email en memoria se mantiene también en modo real porque
 * algunos endpoints internos (y tests de integración) lo consultan; no afecta la
 * entrega real y es información volátil del proceso.
 */

const { Resend } = require('resend');

const env = require('../config/env');
const logger = require('../utils/logger');

const _lastEmail = { to: null, subject: null, body: null, at: null };

// Cliente Resend lazy: se inicializa la primera vez que se envía un email real.
// Esto evita crashear al boot si RESEND_API_KEY no está presente en modo mock.
let _resendClient = null;
function getResendClient() {
  if (_resendClient) return _resendClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY no configurada y MOCK_EXTERNAL_SERVICES=false');
  }
  _resendClient = new Resend(apiKey);
  return _resendClient;
}

function getFromAddress() {
  return process.env.RESEND_FROM || 'Cuponiko <no-reply@cuponiko.com>';
}

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

  try {
    const resend = getResendClient();
    const { data, error } = await resend.emails.send({
      from: getFromAddress(),
      to,
      subject,
      text: body,
    });

    if (error) {
      logger.error('email_send_failed', { to, subject, error: error.message || String(error) });
      throw new Error(`Resend error: ${error.message || String(error)}`);
    }

    logger.info('email_sent', { to, subject, id: data && data.id });
    return { id: (data && data.id) || 'resend-' + Date.now() };
  } catch (err) {
    logger.error('email_send_exception', { to, subject, error: err.message });
    throw err;
  }
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
