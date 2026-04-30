'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');

const ISSUER = 'cuponiko-api';

function signAccessToken(payload) {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
    issuer: ISSUER,
    audience: 'cuponiko-app',
  });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL,
    issuer: ISSUER,
    audience: 'cuponiko-refresh',
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_SECRET, {
    issuer: ISSUER,
    audience: 'cuponiko-app',
  });
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, {
    issuer: ISSUER,
    audience: 'cuponiko-refresh',
  });
}

function issueTokenPair(user) {
  const payload = {
    sub: String(user.id),
    role: user.role,
    email: user.email,
  };
  return {
    access_token: signAccessToken(payload),
    refresh_token: signRefreshToken({ sub: String(user.id) }),
  };
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  issueTokenPair,
};
