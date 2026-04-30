'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const env = require('../config/env');

function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, env.BCRYPT_COST);
}

async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

/**
 * Genera un código numérico aleatorio de n dígitos (0-padded).
 * Para verificación email/phone (6 dígitos por contrato).
 */
function generateNumericCode(digits = 6) {
  const max = 10 ** digits;
  const n = crypto.randomInt(0, max);
  return String(n).padStart(digits, '0');
}

/**
 * Genera un token opaco para password reset — urlsafe base64, 32 bytes.
 */
function generateOpaqueToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

module.exports = {
  sha256,
  hashPassword,
  verifyPassword,
  generateNumericCode,
  generateOpaqueToken,
};
