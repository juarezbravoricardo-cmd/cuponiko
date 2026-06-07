'use strict';

/**
 * Servicio de autenticación — lógica pura (sin req/res).
 * Se invoca desde routes/auth.js.
 *
 * Regla crítica (AP-03): todo flujo multi-tabla debe correr en transacción.
 * - registerBusiness: INSERT users + INSERT businesses + INSERT phone_verification_tokens + INSERT email_verification_tokens
 * - verifyEmail / verifyPhone: UPDATE atómico con WHERE ... RETURNING
 */

const { query, withTransaction } = require('../config/db');
const { AppError } = require('../utils/AppError');
const {
  hashPassword,
  verifyPassword,
  sha256,
  generateNumericCode,
  generateOpaqueToken,
} = require('../utils/hash');
const { issueTokenPair, verifyRefreshToken, signAccessToken, signRefreshToken } =
  require('../utils/jwt');
const { sendVerificationCode: sendSmsCode } = require('./twilio');
const { sendVerificationEmail, sendPasswordResetEmail } = require('./email');
const { geocodeAddress } = require('./geocoding');
const { verifyGoogleToken } = require('./googleOAuth');

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const PHONE_E164_RE = /^\+[0-9]{10,15}$/;
const PASSWORD_RE_LEN = 8;

function assertEmail(email) {
  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Email inválido.');
  }
}

function assertPassword(password) {
  if (
    !password ||
    typeof password !== 'string' ||
    password.length < PASSWORD_RE_LEN ||
    !/[0-9]/.test(password)
  ) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'La contraseña debe tener al menos 8 caracteres y un número.'
    );
  }
}

function assertFullName(fullName) {
  if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Nombre es requerido.');
  }
}

async function createEmailVerificationCode(client, userId, email) {
  const code = generateNumericCode(6);
  const codeHash = sha256(code);
  await client.query(
    `INSERT INTO email_verification_tokens (user_id, email, code_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '30 minutes')`,
    [userId, email, codeHash]
  );
  return code;
}

async function createPhoneVerificationCode(client, userId, phone) {
  const code = generateNumericCode(6);
  const codeHash = sha256(code);
  await client.query(
    `INSERT INTO phone_verification_tokens (user_id, phone, code_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')`,
    [userId, phone, codeHash]
  );
  return code;
}

// ─────────────────────────────────────────────────────────────
// AUTH-01
// ─────────────────────────────────────────────────────────────
async function registerConsumer({ email, password, full_name }) {
  assertEmail(email);
  assertPassword(password);
  assertFullName(full_name);

  const emailLower = email.toLowerCase();

  return withTransaction(async (client) => {
    const existing = await client.query(
      'SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1',
      [emailLower]
    );
    if (existing.rowCount > 0) {
      throw new AppError(
        409,
        'EMAIL_EXISTS',
        'Este correo ya está registrado. ¿Quieres iniciar sesión?'
      );
    }

    const passwordHash = await hashPassword(password);
    const ins = await client.query(
      `INSERT INTO users (email, password_hash, full_name, role, is_active, email_verified)
       VALUES ($1, $2, $3, 'consumer', TRUE, FALSE)
       RETURNING id, email, role, email_verified`,
      [emailLower, passwordHash, full_name.trim()]
    );
    const user = ins.rows[0];
    const code = await createEmailVerificationCode(client, user.id, user.email);

    return {
      user_id: user.id,
      email: user.email,
      role: user.role,
      email_verified: user.email_verified,
      _code: code,
    };
  });

  // FUERA de la transacción: envío de email no-bloqueante
  let emailSent = true;
  try {
    await sendVerificationEmail(result.email, result._code);
  } catch (err) {
    emailSent = false;
    console.error('[registerConsumer] email_send_failed_non_blocking', {
      user_id: result.user_id,
      error: err?.message,
    });
  }

  return {
    user_id: result.user_id,
    email: result.email,
    role: result.role,
    email_verified: result.email_verified,
    email_sent: emailSent,
    message: emailSent
      ? 'Cuenta creada. Revisa tu correo para verificar.'
      : 'Cuenta creada. No pudimos enviar el correo de verificación; puedes solicitarlo de nuevo desde la pantalla de inicio de sesión.',
    _debug_code: process.env.NODE_ENV === 'test' ? result._code : undefined,
  };
}

// ─────────────────────────────────────────────────────────────
// AUTH-02 — Registro con Google
// ─────────────────────────────────────────────────────────────
async function registerWithGoogle({ google_token }) {
  if (!google_token) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Token de Google requerido.');
  }
  const gpayload = await verifyGoogleToken(google_token);
  const emailLower = gpayload.email.toLowerCase();

  return withTransaction(async (client) => {
    const existing = await client.query(
      'SELECT id, google_id, password_hash FROM users WHERE LOWER(email) = $1',
      [emailLower]
    );
    if (existing.rowCount > 0) {
      const u = existing.rows[0];
      if (u.google_id && u.google_id === gpayload.sub) {
        // Ya tenía Google → tratamos como login
        const full = await client.query('SELECT id, email, role FROM users WHERE id = $1', [u.id]);
        const user = full.rows[0];
        return {
          user_id: user.id,
          ...issueTokenPair(user),
          role: user.role,
          email_verified: true,
        };
      }
      throw new AppError(
        409,
        'EMAIL_EXISTS',
        'Este correo ya está registrado con contraseña. Inicia sesión normalmente.'
      );
    }

    const ins = await client.query(
      `INSERT INTO users (email, full_name, role, is_active, email_verified, google_id)
       VALUES ($1, $2, 'consumer', TRUE, TRUE, $3)
       RETURNING id, email, role`,
      [emailLower, gpayload.name || emailLower.split('@')[0], gpayload.sub]
    );
    const user = ins.rows[0];
    return {
      user_id: user.id,
      ...issueTokenPair(user),
      role: user.role,
      email_verified: true,
    };
  });
}

// ─────────────────────────────────────────────────────────────
// AUTH-03 — Registro de negocio
// ─────────────────────────────────────────────────────────────
async function registerBusiness({
  email,
  password,
  full_name,
  business_name,
  category,
  address_input,
  phone,
  logo_url, // opcional; el upload de archivo lo maneja la ruta
  lat,      // opcional (post pin-draggable). Si llega del frontend, se prefiere sobre geocoding.
  lng,      // opcional. Misma semántica.
}) {
  // Validación 2: campos requeridos
  if (
    !email ||
    !password ||
    !full_name ||
    !business_name ||
    !category ||
    !address_input ||
    !phone
  ) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Todos los campos son obligatorios.');
  }
  assertEmail(email);
  assertPassword(password);
  if (!PHONE_E164_RE.test(phone)) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Formato de teléfono inválido. Usa +52 seguido de 10 dígitos.'
    );
  }

  const emailLower = email.toLowerCase();

  // 5/6: email y phone no existentes
  const dup = await query(
    `SELECT
       BOOL_OR(LOWER(email) = $1) AS email_dup,
       BOOL_OR(phone = $2) AS phone_dup
     FROM users
     WHERE LOWER(email) = $1 OR phone = $2`,
    [emailLower, phone]
  );
  if (dup.rows[0]?.email_dup) {
    throw new AppError(409, 'EMAIL_EXISTS', 'Este correo ya está registrado.');
  }
  if (dup.rows[0]?.phone_dup) {
    throw new AppError(409, 'PHONE_EXISTS', 'Este número ya está asociado a otra cuenta.');
  }

  // 7: resolución de coordenadas.
  // Preferencia: lat/lng del pin draggable del frontend (precisas, ubicación exacta
  // del local elegida por el dueño). Fallback: geocoding desde texto, que mantiene
  // compatibilidad con APKs antiguos que aún no envían lat/lng. Si llegan vía
  // multipart/form-data como strings, se convierten a number antes de validar.
  const latNum = typeof lat === 'string' ? Number(lat) : lat;
  const lngNum = typeof lng === 'string' ? Number(lng) : lng;
  const hasValidPin =
    typeof latNum === 'number' &&
    Number.isFinite(latNum) &&
    latNum >= -90 &&
    latNum <= 90 &&
    typeof lngNum === 'number' &&
    Number.isFinite(lngNum) &&
    lngNum >= -180 &&
    lngNum <= 180;

  let geo;
  if (hasValidPin) {
    geo = {
      lat: latNum,
      lng: lngNum,
      display_address: address_input.trim(),
    };
  } else {
    geo = await geocodeAddress(address_input);
  }

  // Transacción: SOLO INSERTs en DB (users + businesses + email token)
  const result = await withTransaction(async (client) => {
    const passwordHash = await hashPassword(password);
    const userIns = await client.query(
      `INSERT INTO users (email, password_hash, full_name, phone, role, is_active,
                          email_verified, phone_verified)
       VALUES ($1, $2, $3, $4, 'business', TRUE, FALSE, FALSE)
       RETURNING id, email`,
      [emailLower, passwordHash, full_name.trim(), phone]
    );
    const userId = userIns.rows[0].id;

    const bizIns = await client.query(
      `INSERT INTO businesses
         (user_id, business_name, category, lat, lng, display_address, location,
          logo_url, plan, status)
       VALUES ($1, $2, $3, $4::double precision, $5::double precision, $6,
               ST_SetSRID(ST_MakePoint($5::double precision, $4::double precision), 4326)::geography,
               $7, 'free', 'active')
       RETURNING id`,
      [
        userId,
        business_name.trim(),
        category.trim(),
        geo.lat,
        geo.lng,
        geo.display_address,
        logo_url || null,
      ]
    );
     const businessId = bizIns.rows[0].id;
    const emailCode = await createEmailVerificationCode(client, userId, emailLower);
    // DIFERIDO: verificación telefónica se activa en fase de tracción (+50 negocios).
    // El campo `phone` se sigue recolectando y guardando en businesses (es necesario
    // para el perfil del negocio), pero no se inserta token ni se envía SMS.
    // const phoneCode = await createPhoneVerificationCode(client, userId, phone);
    // NO llamar sendVerificationEmail aquí: el envío SMTP es no-bloqueante y se hace
    // FUERA de la transacción para evitar que un fallo de email haga rollback del registro.
    // DIFERIDO: ver comentario arriba.
    // await sendSmsCode(phone, phoneCode);

    return {
      user_id: userId,
      business_id: businessId,
      emailLower,
      emailCode,
    };
  });

  // FUERA de la transacción: envío de email no-bloqueante
  let emailSent = true;
  try {
    await sendVerificationEmail(result.emailLower, result.emailCode);
  } catch (err) {
    emailSent = false;
    console.error('[registerBusiness] email_send_failed_non_blocking', {
      user_id: result.user_id,
      error: err?.message,
    });
  }

  return {
    user_id: result.user_id,
    business_id: result.business_id,
    email_verified: false,
    phone_verified: false,
    email_sent: emailSent,
    message: emailSent
      ? 'Cuenta creada. Te enviamos un código a tu correo para verificar.'
      : 'Cuenta creada. No pudimos enviar el correo de verificación; puedes solicitarlo de nuevo desde la pantalla de inicio de sesión.',
    _debug_email_code: process.env.NODE_ENV === 'test' ? result.emailCode : undefined,
    // DIFERIDO: phoneCode no se genera mientras la verificación telefónica esté desactivada.
    _debug_phone_code: undefined,
  };
}

// ─────────────────────────────────────────────────────────────
// AUTH-04 — Verificar email
// ─────────────────────────────────────────────────────────────
async function verifyEmail({ email, code }) {
  if (!email || !code) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Email y código son requeridos.');
  }
  const emailLower = String(email).toLowerCase();

  const userRes = await query('SELECT id, email_verified FROM users WHERE LOWER(email) = $1', [
    emailLower,
  ]);
  if (userRes.rowCount === 0) {
    throw new AppError(404, 'USER_NOT_FOUND', 'No encontramos una cuenta con ese correo.');
  }
  const user = userRes.rows[0];
  const codeHash = sha256(code);

  // UPDATE atómico: solo marca used=true si existe un token válido.
  const upd = await query(
    `UPDATE email_verification_tokens
        SET used = TRUE
      WHERE user_id = $1
        AND code_hash = $2
        AND used = FALSE
        AND expires_at > NOW()
      RETURNING id`,
    [user.id, codeHash]
  );

  if (upd.rowCount === 0) {
    // Investigar motivo específico
    const existing = await query(
      `SELECT id, expires_at, used
         FROM email_verification_tokens
        WHERE user_id = $1 AND code_hash = $2
        ORDER BY created_at DESC LIMIT 1`,
      [user.id, codeHash]
    );
    if (existing.rowCount === 0) {
      throw new AppError(400, 'INVALID_CODE', 'Código incorrecto.');
    }
    const t = existing.rows[0];
    if (t.used) {
      throw new AppError(400, 'INVALID_CODE', 'Código incorrecto.');
    }
    if (new Date(t.expires_at) <= new Date()) {
      throw new AppError(400, 'CODE_EXPIRED', 'El código ha expirado. Solicita uno nuevo.');
    }
    throw new AppError(400, 'INVALID_CODE', 'Código incorrecto.');
  }

  await query('UPDATE users SET email_verified = TRUE WHERE id = $1', [user.id]);

  return { email_verified: true, message: 'Email verificado correctamente.' };
}

// ─────────────────────────────────────────────────────────────
// AUTH-05 — Verificar teléfono
// ─────────────────────────────────────────────────────────────
async function verifyPhone({ user_id, code }) {
  if (!user_id || !code) {
    throw new AppError(404, 'TOKEN_NOT_FOUND', 'No hay verificación pendiente.');
  }

  // 1. token existe
  const tokRes = await query(
    `SELECT id, code_hash, expires_at, attempts, used
       FROM phone_verification_tokens
      WHERE user_id = $1 AND used = FALSE
      ORDER BY created_at DESC
      LIMIT 1`,
    [user_id]
  );
  if (tokRes.rowCount === 0) {
    throw new AppError(404, 'TOKEN_NOT_FOUND', 'No hay verificación pendiente.');
  }
  const tok = tokRes.rows[0];

  // 2. attempts < 3
  if (tok.attempts >= 3) {
    throw new AppError(429, 'MAX_ATTEMPTS', 'Demasiados intentos. Solicita un nuevo código.');
  }

  // 3/4: code match + not expired
  const codeHash = sha256(code);
  const matches = tok.code_hash === codeHash;
  const expired = new Date(tok.expires_at) <= new Date();

  if (!matches || expired) {
    // Incrementar attempts antes de retornar
    await query(
      'UPDATE phone_verification_tokens SET attempts = attempts + 1 WHERE id = $1',
      [tok.id]
    );
    if (expired) {
      throw new AppError(400, 'CODE_EXPIRED', 'El código ha expirado. Solicita uno nuevo.');
    }
    // Si tras incrementar attempts llega a 3, el próximo intento devolverá MAX_ATTEMPTS.
    throw new AppError(400, 'INVALID_CODE', 'Código incorrecto.');
  }

  // OK: marcar used + phone_verified
  await withTransaction(async (client) => {
    await client.query('UPDATE phone_verification_tokens SET used = TRUE WHERE id = $1', [tok.id]);
    await client.query('UPDATE users SET phone_verified = TRUE WHERE id = $1', [user_id]);
  });

  return { phone_verified: true };
}

// ─────────────────────────────────────────────────────────────
// AUTH-06 — Login
// ─────────────────────────────────────────────────────────────
const GENERIC_CREDS_MSG = 'Correo o contraseña incorrectos.';

async function login({ email, password }) {
  if (!email || !password) {
    // No damos pista de qué falta
    throw new AppError(401, 'INVALID_CREDENTIALS', GENERIC_CREDS_MSG);
  }
  const emailLower = String(email).toLowerCase();

  const res = await query(
    `SELECT id, email, role, full_name, password_hash, is_active, email_verified, phone_verified
       FROM users WHERE LOWER(email) = $1`,
    [emailLower]
  );
  const user = res.rows[0];
  const hash = user?.password_hash;
  // bcrypt dummy hash para mantener tiempo constante si no existe usuario
  const ok = await verifyPassword(password, hash || '$2b$12$invalidinvalidinvalidinvalidinO');

  if (!user || !ok) {
    throw new AppError(401, 'INVALID_CREDENTIALS', GENERIC_CREDS_MSG);
  }

  if (!user.is_active) {
    throw new AppError(
      403,
      'ACCOUNT_BLOCKED',
      'Tu cuenta ha sido suspendida. Contacta soporte.'
    );
  }
  if (!user.email_verified) {
    throw new AppError(
      403,
      'EMAIL_NOT_VERIFIED',
      'Verifica tu correo antes de iniciar sesión.'
    );
  }
  // DIFERIDO: verificación telefónica se activa en fase de tracción (+50 negocios).
  // La condición phone_verified se mantiene en DB pero no bloquea login.
  // if (user.role === 'business' && !user.phone_verified) {
  //   throw new AppError(
  //     403,
  //     'PHONE_NOT_VERIFIED',
  //     'Verifica tu teléfono para acceder como negocio.'
  //   );
  // }

  return {
    ...issueTokenPair(user),
    user: {
      id: user.id,
      role: user.role,
      full_name: user.full_name,
      email: user.email,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// AUTH-07 — Login con Google
// ─────────────────────────────────────────────────────────────
async function loginWithGoogle({ google_token }) {
  const gpayload = await verifyGoogleToken(google_token);
  const emailLower = gpayload.email.toLowerCase();

  const res = await query(
    `SELECT id, email, role, full_name, is_active, google_id
       FROM users
      WHERE LOWER(email) = $1 AND google_id = $2`,
    [emailLower, gpayload.sub]
  );
  if (res.rowCount === 0) {
    throw new AppError(404, 'USER_NOT_FOUND', 'No encontramos una cuenta. ¿Quieres registrarte?');
  }
  const user = res.rows[0];
  if (!user.is_active) {
    throw new AppError(403, 'ACCOUNT_BLOCKED', 'Tu cuenta ha sido suspendida. Contacta soporte.');
  }
  return {
    ...issueTokenPair(user),
    user: {
      id: user.id,
      role: user.role,
      full_name: user.full_name,
      email: user.email,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// AUTH-08 — Refresh token
// ─────────────────────────────────────────────────────────────
async function refreshSession({ refresh_token }) {
  if (!refresh_token) {
    throw new AppError(401, 'REFRESH_INVALID', 'Sesión expirada. Inicia sesión de nuevo.');
  }
  let payload;
  try {
    payload = verifyRefreshToken(refresh_token);
  } catch (_e) {
    throw new AppError(401, 'REFRESH_INVALID', 'Sesión expirada. Inicia sesión de nuevo.');
  }
  const userId = Number(payload.sub);
  const res = await query(
    'SELECT id, email, role, is_active FROM users WHERE id = $1',
    [userId]
  );
  if (res.rowCount === 0 || !res.rows[0].is_active) {
    throw new AppError(401, 'REFRESH_INVALID', 'Sesión expirada. Inicia sesión de nuevo.');
  }
  const user = res.rows[0];
  return {
    access_token: signAccessToken({ sub: String(user.id), role: user.role, email: user.email }),
    refresh_token: signRefreshToken({ sub: String(user.id) }),
  };
}

// ─────────────────────────────────────────────────────────────
// AUTH-09 — Forgot password
// ─────────────────────────────────────────────────────────────
async function forgotPassword({ email }) {
  const msg = {
    message:
      'Si el correo está registrado, recibirás instrucciones para restablecer tu contraseña.',
  };
  if (!email || typeof email !== 'string') return msg;
  const emailLower = email.toLowerCase();

  const userRes = await query('SELECT id, email FROM users WHERE LOWER(email) = $1', [emailLower]);
  if (userRes.rowCount === 0) {
    return msg;
  }
  const user = userRes.rows[0];
  const token = generateOpaqueToken(32);
  const tokenHash = sha256(token);
  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
    [user.id, tokenHash]
  );
  const url = `cuponiko://auth/reset-password?token=${token}`;

  // Envío defensivo: si Resend falla, el endpoint sigue devolviendo 200
  // con el mensaje genérico anti-enumeration. Solo loggeamos el error.
  try {
    await sendPasswordResetEmail(user.email, url);
  } catch (err) {
    console.error('[forgotPassword] email_password_reset_failed', {
      email: user.email,
      error: err?.message,
    });
  }

  // En tests, devolvemos el token para poder consumirlo
  if (process.env.NODE_ENV === 'test') {
    return { ...msg, _debug_token: token };
  }
  return msg;
}

// ─────────────────────────────────────────────────────────────
// AUTH-10 — Reset password
// ─────────────────────────────────────────────────────────────
async function resetPassword({ token, new_password }) {
  if (!token) {
    throw new AppError(400, 'INVALID_TOKEN', 'Este enlace ya no es válido. Solicita uno nuevo.');
  }
  const tokenHash = sha256(token);

  const tokRes = await query(
    'SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token_hash = $1',
    [tokenHash]
  );
  if (tokRes.rowCount === 0) {
    throw new AppError(400, 'INVALID_TOKEN', 'Este enlace ya no es válido. Solicita uno nuevo.');
  }
  const t = tokRes.rows[0];
  if (t.used) {
    throw new AppError(400, 'TOKEN_USED', 'Este enlace ya fue utilizado.');
  }
  if (new Date(t.expires_at) <= new Date()) {
    throw new AppError(400, 'TOKEN_EXPIRED', 'Este enlace ya no es válido. Solicita uno nuevo.');
  }
  assertPassword(new_password);

  const newHash = await hashPassword(new_password);
  await withTransaction(async (client) => {
    // Atómico: marcar used=true y actualizar password
    const mark = await client.query(
      `UPDATE password_reset_tokens
          SET used = TRUE
        WHERE id = $1 AND used = FALSE AND expires_at > NOW()
        RETURNING id`,
      [t.id]
    );
    if (mark.rowCount === 0) {
      throw new AppError(400, 'INVALID_TOKEN', 'Este enlace ya no es válido. Solicita uno nuevo.');
    }
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, t.user_id]);
  });

  return { message: 'Contraseña actualizada.' };
}

module.exports = {
  registerConsumer,
  registerWithGoogle,
  registerBusiness,
  verifyEmail,
  verifyPhone,
  login,
  loginWithGoogle,
  refreshSession,
  forgotPassword,
  resetPassword,
};
