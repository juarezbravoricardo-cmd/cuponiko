'use strict';

/**
 * Servicio de verificación de tokens de Google OAuth 2.0.
 *
 * En producción: usa google-auth-library con el CLIENT_ID para verificar
 * el id_token emitido por Google Sign-In.
 *
 * En modo MOCK_EXTERNAL_SERVICES: acepta tokens con formato
 * `mock:<email>:<google_sub>` y devuelve payload simulado.
 * Útil para tests y desarrollo sin credenciales reales.
 */

const { OAuth2Client } = require('google-auth-library');
const env = require('../config/env');
const { AppError } = require('../utils/AppError');

let _client = null;
function getClient() {
  if (!_client) _client = new OAuth2Client(env.GOOGLE_CLIENT_ID);
  return _client;
}

/**
 * Verifica el token de Google y retorna { email, sub, email_verified, name }.
 * Lanza AppError(401, 'GOOGLE_AUTH_FAILED', ...) si no es válido.
 */
async function verifyGoogleToken(token) {
  if (!token || typeof token !== 'string') {
    throw new AppError(
      401,
      'GOOGLE_AUTH_FAILED',
      'No pudimos verificar tu cuenta de Google. Intenta de nuevo.'
    );
  }

  if (env.MOCK_EXTERNAL_SERVICES) {
    // Formato: "mock:<email>:<sub>:<name?>"
    const parts = token.split(':');
    if (parts[0] !== 'mock' || !parts[1]) {
      throw new AppError(
        401,
        'GOOGLE_AUTH_FAILED',
        'No pudimos verificar tu cuenta de Google. Intenta de nuevo.'
      );
    }
    return {
      email: parts[1].toLowerCase(),
      sub: parts[2] || `mock-sub-${parts[1]}`,
      email_verified: true,
      name: parts[3] || parts[1].split('@')[0],
    };
  }

  try {
    const ticket = await getClient().verifyIdToken({
      idToken: token,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    return {
      email: String(payload.email).toLowerCase(),
      sub: payload.sub,
      email_verified: Boolean(payload.email_verified),
      name: payload.name || payload.given_name || payload.email.split('@')[0],
    };
  } catch (_err) {
    throw new AppError(
      401,
      'GOOGLE_AUTH_FAILED',
      'No pudimos verificar tu cuenta de Google. Intenta de nuevo.'
    );
  }
}

module.exports = { verifyGoogleToken };
