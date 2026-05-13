'use strict';

/**
 * Centraliza el acceso a variables de entorno.
 * - Lee .env al cargar.
 * - Expone un objeto inmutable `env` con defaults seguros.
 * - Lanza error temprano si falta algo crítico en producción.
 */

require('dotenv').config();

const required = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];

const env = Object.freeze({
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),

  DATABASE_URL: process.env.DATABASE_URL,

  JWT_SECRET: process.env.JWT_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_ACCESS_TTL: process.env.JWT_ACCESS_TTL || '15m',
  JWT_REFRESH_TTL: process.env.JWT_REFRESH_TTL || '7d',
  INTERNAL_SECRET: process.env.INTERNAL_SECRET || 'dev-internal-secret',

  BCRYPT_COST: parseInt(process.env.BCRYPT_COST || '12', 10),

  MOCK_EXTERNAL_SERVICES:
    (process.env.MOCK_EXTERNAL_SERVICES || 'false').toLowerCase() === 'true',

  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,

  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_PRICE_PREMIUM: process.env.STRIPE_PRICE_PREMIUM,
  STRIPE_SUCCESS_URL: process.env.STRIPE_SUCCESS_URL,
  STRIPE_CANCEL_URL: process.env.STRIPE_CANCEL_URL,

  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,

  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,

  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM: process.env.RESEND_FROM || 'Cuponiko <no-reply@cuponiko.com>',

  RATE_LIMIT_GLOBAL_PER_MIN: parseInt(process.env.RATE_LIMIT_GLOBAL_PER_MIN || '100', 10),
  RATE_LIMIT_BUSINESS_REGISTER_PER_DAY: parseInt(
    process.env.RATE_LIMIT_BUSINESS_REGISTER_PER_DAY || '3', 10
  ),
});

if (env.NODE_ENV === 'production') {
  for (const k of required) {
    if (!process.env[k]) {
      throw new Error(`ENV faltante en producción: ${k}`);
    }
  }
  // Si no estamos en modo mock, los servicios externos reales son obligatorios.
  // Por ahora validamos Resend; Stripe/Twilio se validan al usarse en sus servicios.
  if (!env.MOCK_EXTERNAL_SERVICES && !env.RESEND_API_KEY) {
    throw new Error('ENV faltante en producción: RESEND_API_KEY (requerida cuando MOCK_EXTERNAL_SERVICES=false)');
  }
}

module.exports = env;
