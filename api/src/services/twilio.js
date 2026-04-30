'use strict';

/**
 * Envío de SMS a través de Twilio.
 * En modo mock: no llama a Twilio, sino que registra el último mensaje en memoria
 * para que los tests puedan inspeccionarlo.
 */

const env = require('../config/env');
const logger = require('../utils/logger');

const _lastSms = { to: null, body: null, at: null };

function getLastMockSms() {
  return { ..._lastSms };
}

function resetLastMockSms() {
  _lastSms.to = null;
  _lastSms.body = null;
  _lastSms.at = null;
}

async function sendSms(to, body) {
  if (env.MOCK_EXTERNAL_SERVICES) {
    _lastSms.to = to;
    _lastSms.body = body;
    _lastSms.at = new Date().toISOString();
    logger.info('sms_mock', { to, body });
    return { sid: 'SMmock' + Date.now() };
  }
  // Producción
  // eslint-disable-next-line global-require
  const twilio = require('twilio');
  const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  const msg = await client.messages.create({
    body,
    from: env.TWILIO_PHONE_NUMBER,
    to,
  });
  return { sid: msg.sid };
}

async function sendVerificationCode(phone, code) {
  const body = `Tu código de verificación Cuponiko es: ${code}`;
  return sendSms(phone, body);
}

module.exports = { sendSms, sendVerificationCode, getLastMockSms, resetLastMockSms };
