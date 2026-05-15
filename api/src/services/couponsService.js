'use strict';

/**
 * couponsService — Lógica de cupones (Fase 2).
 *
 * Endpoints cubiertos:
 *  - CPN-01 POST /api/coupons
 *  - CPN-02 GET  /api/coupons/my-coupons
 *  - CPN-03 PATCH /api/coupons/:coupon_id/pause
 *  - CPN-04 PATCH /api/coupons/:coupon_id/activate
 *  - CPN-05 POST /api/coupons/:coupon_id/save
 *  - CPN-06 POST /api/coupons/:instance_id/generate-qr
 *  - CPN-07 POST /api/coupons/redeem  (ENDPOINT CRÍTICO)
 *
 * Reglas NO NEGOCIABLES aplicadas aquí:
 *  - AP-01/02: UPDATE ... WHERE condición ... RETURNING — nunca SELECT+UPDATE.
 *  - AP-03: CPN-07 corre 100% dentro de una `withTransaction`.
 *  - AP-04: CPN-05 usa ON CONFLICT (coupon_id, consumer_id) DO NOTHING.
 *  - AP-13: máquina de estados explícita en CPN-03/04.
 *  - AP-14: el JWT del QR se hashea (sha256) antes de persistir.
 *  - AP-17: redemption_tokens.business_id se setea siempre.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { query, withTransaction } = require('../config/db');
const { AppError } = require('../utils/AppError');
const env = require('../config/env');
const logger = require('../utils/logger');
const {
  getBusinessByUserId,
  assertBusinessActive,
  assertCanActivateMoreCoupons,
  assertCanReactivatePausedByDowngrade,
  assertTransferableAllowed,
} = require('../middleware/planChecker');
const {
  registerScanFailure,
  resetScanHistory,
} = require('../middleware/scannerLimiter');

// ────────────────────────────────────────────────────────────
// Helpers de validación comunes
// ────────────────────────────────────────────────────────────
const DISCOUNT_TYPES = new Set(['percent', 'fixed', '2x1', 'free']);
const STATUS_FILTERS = new Set(['active', 'paused', 'expired', 'all']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateYmd(s, label) {
  if (typeof s !== 'string' || !ISO_DATE_RE.test(s)) {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} inválida.`);
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(400, 'VALIDATION_ERROR', `${label} inválida.`);
  }
  return d;
}

function todayUtcYmd() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

/**
 * Genera short_code: primeros 8 chars de `base36(jti)` en mayúsculas.
 * JTI es un UUID sin guiones, así que lo convertimos a BigInt → base36.
 * Se asegura longitud de 8 con padding si el jti genera base36 corto.
 */
function makeShortCodeFromJti(jti) {
  const hex = jti.replace(/-/g, '').slice(0, 16); // 64 bits
  const asBig = BigInt(`0x${hex}`);
  let b36 = asBig.toString(36).toUpperCase();
  if (b36.length < 8) b36 = b36.padStart(8, '0');
  return b36.slice(0, 8);
}

// ────────────────────────────────────────────────────────────
// CPN-01 — Crear cupón
// ────────────────────────────────────────────────────────────
async function createCoupon(userId, body) {
  const b = body || {};

  // Normalización de flags
  const transferable = b.transferable === true;
  const accumulable = b.accumulable === true;
  const singleUse = b.single_use === undefined ? true : Boolean(b.single_use);
  const usageLimitPerUser = b.usage_limit_per_user ?? 1;
  const maxAccumulatedDiscount = b.max_accumulated_discount ?? 70;
  const maxCouponsPerTx = b.max_coupons_per_tx ?? 2;

  return withTransaction(async (client) => {
    // 1: Business status active
    const biz = await getBusinessByUserId(client, userId);
    assertBusinessActive(biz);

    // 2: título
    if (!b.title || typeof b.title !== 'string' || !b.title.trim() || b.title.length > 255) {
      throw new AppError(400, 'VALIDATION_ERROR', 'El título del cupón es obligatorio.');
    }

    // 3: discount_type en ENUM
    if (!DISCOUNT_TYPES.has(b.discount_type)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Tipo de descuento inválido.');
    }

    // 4: discount_value > 0
    const discountValue = Number(b.discount_value);
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'El valor del descuento debe ser mayor a 0.');
    }

    // 5: percent ≤ 100
    if (b.discount_type === 'percent' && discountValue > 100) {
      throw new AppError(400, 'VALIDATION_ERROR', 'El porcentaje no puede ser mayor a 100%.');
    }

    // 6: 2x1/free requieren precio_referencia > 0
    let precioReferencia = null;
    if (b.precio_referencia !== undefined && b.precio_referencia !== null) {
      precioReferencia = Number(b.precio_referencia);
    }
    if (b.discount_type === '2x1' || b.discount_type === 'free') {
      if (!(precioReferencia > 0)) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'El precio de referencia es obligatorio para cupones 2x1 y gratis.'
        );
      }
    } else if (precioReferencia !== null && !(precioReferencia > 0)) {
      // precio_referencia opcional para percent/fixed, si viene debe ser > 0
      throw new AppError(400, 'VALIDATION_ERROR', 'Precio de referencia inválido.');
    }

    // 7: 2x1/free no pueden ser accumulable
    if ((b.discount_type === '2x1' || b.discount_type === 'free') && accumulable) {
      throw new AppError(
        400,
        'INVALID_COMBINATION',
        'Los cupones 2x1 y gratis no pueden ser acumulables.'
      );
    }

    // 8: end_date >= start_date
    const start = parseDateYmd(b.start_date, 'Fecha de inicio');
    const end = parseDateYmd(b.end_date, 'Fecha de fin');
    if (end < start) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'La fecha de fin debe ser posterior a la fecha de inicio.'
      );
    }

    // 9: start_date >= TODAY
    const today = parseDateYmd(todayUtcYmd(), 'Fecha de inicio');
    if (start < today) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'La fecha de inicio no puede ser en el pasado.'
      );
    }

    // 10: total_usage_limit > 0
    const totalUsageLimit = Number(b.total_usage_limit);
    if (!Number.isFinite(totalUsageLimit) || totalUsageLimit <= 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Define un límite de canjes totales.');
    }
    const upu = Number(usageLimitPerUser);
    if (!Number.isFinite(upu) || upu <= 0 || upu > totalUsageLimit) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Límite por usuario inválido.');
    }

    // 11/12: accumulable → max_accumulated_discount y max_coupons_per_tx rangos
    if (accumulable) {
      if (
        !Number.isFinite(Number(maxAccumulatedDiscount)) ||
        maxAccumulatedDiscount < 50 ||
        maxAccumulatedDiscount > 90
      ) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'El tope de acumulación debe estar entre 50% y 90%.'
        );
      }
      if (
        !Number.isFinite(Number(maxCouponsPerTx)) ||
        maxCouponsPerTx < 1 ||
        maxCouponsPerTx > 3
      ) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'El máximo de cupones por transacción debe ser entre 1 y 3.'
        );
      }
    }

    // 13: transferable ⇒ plan premium
    assertTransferableAllowed(biz.plan, transferable);

    // 14: Plan free ⇒ máx 1 activo
    await assertCanActivateMoreCoupons(client, biz.id, biz.plan);

    // INSERT
    const ins = await client.query(
      `INSERT INTO coupons (
         business_id, title, description, discount_type, discount_value, precio_referencia,
         start_date, end_date, usage_limit_per_user, total_usage_limit,
         transferable, accumulable, max_accumulated_discount, max_coupons_per_tx,
         single_use, is_ad_exclusive, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, FALSE, 'active')
       RETURNING id, status`,
      [
        biz.id,
        b.title.trim(),
        b.description || null,
        b.discount_type,
        discountValue,
        precioReferencia,
        b.start_date,
        b.end_date,
        upu,
        totalUsageLimit,
        transferable,
        accumulable,
        maxAccumulatedDiscount,
        maxCouponsPerTx,
        singleUse,
      ]
    );
    const row = ins.rows[0];
    return {
      coupon_id: Number(row.id),
      status: row.status,
      message: 'Cupón creado exitosamente.',
    };
  });
}

// ────────────────────────────────────────────────────────────
// CPN-02 — Listar cupones del negocio
// ────────────────────────────────────────────────────────────
async function listMyCoupons(userId, statusFilter) {
  const filter = statusFilter || 'all';
  if (!STATUS_FILTERS.has(filter)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Filtro de estado inválido.');
  }
  const bizRes = await query('SELECT id FROM businesses WHERE user_id = $1', [userId]);
  if (bizRes.rowCount === 0) {
    throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Negocio no encontrado.');
  }
  const businessId = bizRes.rows[0].id;

  let where = 'business_id = $1';
  const params = [businessId];
  if (filter !== 'all') {
    where += ' AND status = $2';
    params.push(filter);
  }
  const r = await query(
    `SELECT id, title, description, discount_type, discount_value, precio_referencia,
            start_date, end_date, usage_limit_per_user, total_usage_limit, uses_count,
            transferable, accumulable, max_accumulated_discount, max_coupons_per_tx,
            single_use, is_ad_exclusive, status, created_at
       FROM coupons
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT 200`,
    params
  );
  return r.rows.map((c) => ({
    coupon_id: Number(c.id),
    title: c.title,
    description: c.description,
    discount_type: c.discount_type,
    discount_value: Number(c.discount_value),
    precio_referencia: c.precio_referencia !== null ? Number(c.precio_referencia) : null,
    start_date: c.start_date,
    end_date: c.end_date,
    usage_limit_per_user: c.usage_limit_per_user,
    total_usage_limit: c.total_usage_limit,
    uses_count: c.uses_count,
    transferable: c.transferable,
    accumulable: c.accumulable,
    max_accumulated_discount: c.max_accumulated_discount,
    max_coupons_per_tx: c.max_coupons_per_tx,
    single_use: c.single_use,
    is_ad_exclusive: c.is_ad_exclusive,
    status: c.status,
    created_at: c.created_at,
  }));
}

// ────────────────────────────────────────────────────────────
// CPN-03 — Pausar cupón (active → paused)
// ────────────────────────────────────────────────────────────
async function pauseCoupon(userId, couponId) {
  // Verificar pertenencia
  const r = await query(
    `SELECT c.id, c.status
       FROM coupons c
       JOIN businesses b ON b.id = c.business_id
      WHERE c.id = $1 AND b.user_id = $2`,
    [couponId, userId]
  );
  if (r.rowCount === 0) {
    throw new AppError(404, 'COUPON_NOT_FOUND', 'Cupón no encontrado.');
  }
  const upd = await query(
    `UPDATE coupons SET status = 'paused'
      WHERE id = $1 AND status = 'active'
      RETURNING id`,
    [couponId]
  );
  if (upd.rowCount === 0) {
    throw new AppError(400, 'INVALID_TRANSITION', 'Solo los cupones activos pueden pausarse.');
  }
  return { coupon_id: Number(couponId), status: 'paused' };
}

// ────────────────────────────────────────────────────────────
// CPN-04 — Reactivar cupón
// ────────────────────────────────────────────────────────────
async function activateCoupon(userId, couponId) {
  return withTransaction(async (client) => {
    const r = await client.query(
      `SELECT c.id, c.status, c.end_date, c.business_id, b.plan, b.status AS b_status
         FROM coupons c
         JOIN businesses b ON b.id = c.business_id
        WHERE c.id = $1 AND b.user_id = $2`,
      [couponId, userId]
    );
    if (r.rowCount === 0) {
      throw new AppError(404, 'COUPON_NOT_FOUND', 'Cupón no encontrado.');
    }
    const c = r.rows[0];
    if (!['paused', 'paused_by_downgrade'].includes(c.status)) {
      throw new AppError(
        400,
        'INVALID_TRANSITION',
        'Este cupón no puede reactivarse desde su estado actual.'
      );
    }

    // 4: end_date >= TODAY
    const today = parseDateYmd(todayUtcYmd(), 'hoy');
    const end = parseDateYmd(
      c.end_date instanceof Date ? c.end_date.toISOString().slice(0, 10) : String(c.end_date),
      'Fecha fin'
    );
    if (end < today) {
      throw new AppError(400, 'COUPON_EXPIRED', 'Este cupón ya venció y no puede reactivarse.');
    }

    // 3: paused_by_downgrade + plan free ⇒ count < 1
    if (c.status === 'paused_by_downgrade') {
      await assertCanReactivatePausedByDowngrade(client, c.business_id, c.plan);
    }

    const upd = await client.query(
      `UPDATE coupons SET status = 'active'
        WHERE id = $1 AND status IN ('paused','paused_by_downgrade')
        RETURNING id`,
      [couponId]
    );
    if (upd.rowCount === 0) {
      // Race: alguien cambió el estado justo antes
      throw new AppError(
        400,
        'INVALID_TRANSITION',
        'Este cupón no puede reactivarse desde su estado actual.'
      );
    }
    return { coupon_id: Number(couponId), status: 'active' };
  });
}

// ────────────────────────────────────────────────────────────
// CPN-05 — Guardar cupón en cartera
// ────────────────────────────────────────────────────────────
async function saveCouponToWallet(consumerId, couponId) {
  // Validación 1/2: cupón + negocio activos
  const c = await query(
    `SELECT c.id, c.status, c.is_ad_exclusive, b.status AS business_status
       FROM coupons c
       JOIN businesses b ON b.id = c.business_id
      WHERE c.id = $1`,
    [couponId]
  );
  if (c.rowCount === 0) {
    throw new AppError(404, 'COUPON_NOT_FOUND', 'Este cupón no está disponible.');
  }
  const row = c.rows[0];
  if (row.status !== 'active' || row.business_status !== 'active') {
    throw new AppError(404, 'COUPON_NOT_FOUND', 'Este cupón no está disponible.');
  }
  if (row.is_ad_exclusive) {
    throw new AppError(400, 'AD_EXCLUSIVE', 'Este cupón solo está disponible desde el anuncio.');
  }

  // INSERT idempotente (AP-04)
  const ins = await query(
    `INSERT INTO coupon_instances (coupon_id, consumer_id)
     VALUES ($1, $2)
     ON CONFLICT (coupon_id, consumer_id) DO NOTHING
     RETURNING id, saved_at, uses_count`,
    [couponId, consumerId]
  );
  let instance;
  if (ins.rowCount === 0) {
    // Ya existía; devolver el registro existente
    const exist = await query(
      `SELECT id, saved_at, uses_count FROM coupon_instances WHERE coupon_id = $1 AND consumer_id = $2`,
      [couponId, consumerId]
    );
    instance = exist.rows[0];
  } else {
    instance = ins.rows[0];
  }
  return {
    coupon_instance_id: Number(instance.id),
    saved_at: instance.saved_at,
    uses_count: instance.uses_count,
    message: 'Cupón guardado en tu cartera.',
  };
}

// ────────────────────────────────────────────────────────────
// CPN-06 — Generar QR de redención
// ────────────────────────────────────────────────────────────
async function generateQr(consumerId, instanceId) {
  return withTransaction(async (client) => {
    // 2: instance pertenece al consumer (join coupon + business)
    const r = await client.query(
      `SELECT ci.id AS instance_id, ci.coupon_id, ci.consumer_id, ci.uses_count AS ci_uses,
              c.status AS coupon_status, c.uses_count, c.total_usage_limit, c.usage_limit_per_user,
              c.business_id, b.status AS business_status
         FROM coupon_instances ci
         JOIN coupons c ON c.id = ci.coupon_id
         JOIN businesses b ON b.id = c.business_id
        WHERE ci.id = $1`,
      [instanceId]
    );
    if (r.rowCount === 0) {
      throw new AppError(404, 'COUPON_NOT_FOUND', 'Cupón no encontrado.');
    }
    const info = r.rows[0];
    if (Number(info.consumer_id) !== Number(consumerId)) {
      throw new AppError(403, 'FORBIDDEN', 'Este cupón no te pertenece.');
    }
    if (info.coupon_status !== 'active') {
      throw new AppError(400, 'COUPON_NOT_ACTIVE', 'Este cupón no está activo.');
    }
    if (info.ci_uses >= info.usage_limit_per_user) {
      throw new AppError(400, 'COUPON_USED', 'Ya usaste este cupón el número máximo de veces.');
    }
    if (info.uses_count >= info.total_usage_limit) {
      throw new AppError(400, 'COUPON_EXHAUSTED', 'Este cupón se ha agotado.');
    }
    if (info.business_status !== 'active') {
      throw new AppError(400, 'BUSINESS_UNAVAILABLE', 'El negocio no está disponible temporalmente.');
    }

    // 1. Invalidar tokens pending anteriores
    await client.query(
      `UPDATE redemption_tokens
          SET status = 'expired'
        WHERE coupon_instance_id = $1 AND status = 'pending'`,
      [instanceId]
    );

    // 2. Generar JWT (AP-14: se persiste sha256, no el JWT)
    const jti = crypto.randomUUID();
    const expiresAtMs = Date.now() + 5 * 60 * 1000;
    const expiresAt = new Date(expiresAtMs);
    const token = jwt.sign(
      {
        coupon_instance_id: Number(info.instance_id),
        consumer_id: Number(info.consumer_id),
      },
      env.JWT_SECRET,
      {
        algorithm: 'HS256',
        expiresIn: Math.ceil((expiresAtMs - Date.now()) / 1000),
        issuer: 'cuponiko-api',
        audience: 'cuponiko-redeem',
        jwtid: jti,
      }
    );
    const tokenHash = sha256(token);
    const shortCode = makeShortCodeFromJti(jti);

    // 3. INSERT token (AP-17: business_id incluido)
    await client.query(
      `INSERT INTO redemption_tokens
         (coupon_instance_id, token_jwt_hash, short_code, expires_at, status, business_id)
       VALUES ($1, $2, $3, $4, 'pending', $5)`,
      [instanceId, tokenHash, shortCode, expiresAt.toISOString(), info.business_id]
    );

    // 4. activity_log (para rate limit qrLimiter)
    await client.query(
      `INSERT INTO activity_logs (user_id, business_id, action, metadata)
       VALUES ($1, $2, 'qr_generated', $3::jsonb)`,
      [
        consumerId,
        info.business_id,
        JSON.stringify({ coupon_instance_id: Number(instanceId), short_code: shortCode }),
      ]
    );

    return {
      jwt: token,
      short_code: shortCode,
      expires_at: expiresAt.toISOString(),
    };
  });
}

// ────────────────────────────────────────────────────────────
// CPN-07 — Redimir cupón (ENDPOINT CRÍTICO)
// ────────────────────────────────────────────────────────────
async function redeemCoupon({ userId, businessId, body }) {
  const { token_jwt: tokenJwt, short_code: shortCodeRaw } = body || {};

  // 2: al menos uno
  if ((!tokenJwt || typeof tokenJwt !== 'string') && (!shortCodeRaw || typeof shortCodeRaw !== 'string')) {
    await registerScanFailure(businessId);
    throw new AppError(400, 'VALIDATION_ERROR', 'Escanea el QR o ingresa el código del cliente.');
  }

  const shortCode = shortCodeRaw ? String(shortCodeRaw).trim().toUpperCase() : null;
  let tokenHash = null;
  let jwtConsumerId = null;

  // 3: Si viene token_jwt, verificar firma
  if (tokenJwt) {
    try {
      const decoded = jwt.verify(tokenJwt, env.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: 'cuponiko-api',
        audience: 'cuponiko-redeem',
      });
      jwtConsumerId = Number(decoded.consumer_id);
    } catch (err) {
      await registerScanFailure(businessId);
      if (err && err.name === 'TokenExpiredError') {
        throw new AppError(410, 'QR_EXPIRED', 'Este QR ha expirado. El cliente puede generar uno nuevo.');
      }
      throw new AppError(401, 'INVALID_QR', 'QR inválido.');
    }
    tokenHash = sha256(tokenJwt);
  }

  // Variable de cierre para alertas que deben sobrevivir a un ROLLBACK
  let pendingTokenReuseAlert = null;

  // Todo lo demás corre en UNA transacción (AP-03).
  try {
    return await withTransaction(async (client) => {
      // Paso 4 — UPDATE atómico del token (AP-02)
      let updRes;
      if (tokenHash && shortCode) {
        updRes = await client.query(
          `UPDATE redemption_tokens
              SET status = 'used', used_at = NOW()
            WHERE (token_jwt_hash = $1 OR short_code = $2)
              AND status = 'pending'
              AND expires_at > NOW()
            RETURNING id, coupon_instance_id, business_id`,
          [tokenHash, shortCode]
        );
      } else if (tokenHash) {
        updRes = await client.query(
          `UPDATE redemption_tokens
              SET status = 'used', used_at = NOW()
            WHERE token_jwt_hash = $1
              AND status = 'pending'
              AND expires_at > NOW()
            RETURNING id, coupon_instance_id, business_id`,
          [tokenHash]
        );
      } else {
        updRes = await client.query(
          `UPDATE redemption_tokens
              SET status = 'used', used_at = NOW()
            WHERE short_code = $1
              AND status = 'pending'
              AND expires_at > NOW()
            RETURNING id, coupon_instance_id, business_id`,
          [shortCode]
        );
      }

      if (updRes.rowCount === 0) {
        // Investigar motivo específico
        let probeRes;
        if (tokenHash && shortCode) {
          probeRes = await client.query(
            `SELECT id, status, expires_at, business_id FROM redemption_tokens
              WHERE token_jwt_hash = $1 OR short_code = $2
              ORDER BY created_at DESC LIMIT 1`,
            [tokenHash, shortCode]
          );
        } else if (tokenHash) {
          probeRes = await client.query(
            `SELECT id, status, expires_at, business_id FROM redemption_tokens
              WHERE token_jwt_hash = $1 ORDER BY created_at DESC LIMIT 1`,
            [tokenHash]
          );
        } else {
          probeRes = await client.query(
            `SELECT id, status, expires_at, business_id FROM redemption_tokens
              WHERE short_code = $1 ORDER BY created_at DESC LIMIT 1`,
            [shortCode]
          );
        }
        if (probeRes.rowCount === 0) {
          throw new AppError(404, 'TOKEN_NOT_FOUND', 'QR inválido.');
        }
        const probe = probeRes.rows[0];
        if (probe.status === 'used') {
          // T-320: marcar para insertar alerta DESPUÉS del rollback
          pendingTokenReuseAlert = {
            description: `Intento de reutilización de token de redención (id=${probe.id}).`,
            business_id: Number(probe.business_id),
          };
          throw new AppError(409, 'ALREADY_REDEEMED', 'Este cupón ya fue canjeado.');
        }
        if (probe.status === 'expired' || new Date(probe.expires_at) <= new Date()) {
          throw new AppError(
            410,
            'QR_EXPIRED',
            'Este QR ha expirado. El cliente puede generar uno nuevo.'
          );
        }
        // Cualquier otro caso raro → 404 QR inválido
        throw new AppError(404, 'TOKEN_NOT_FOUND', 'QR inválido.');
      }

      const tok = updRes.rows[0];

      // AP-17: validar que el token pertenece al negocio que escanea
      if (Number(tok.business_id) !== Number(businessId)) {
        throw new AppError(403, 'NOT_TRANSFERABLE', 'Este cupón no puede ser usado por otra persona.');
      }

      // Obtener cupón + instance + consumer + business para lógica de transferable
      const ctx = await client.query(
        `SELECT ci.id AS instance_id, ci.consumer_id, ci.uses_count AS ci_uses,
                c.id AS coupon_id, c.transferable, c.discount_type, c.discount_value,
                c.precio_referencia, c.total_usage_limit, c.uses_count AS c_uses,
                u.full_name AS consumer_name
           FROM coupon_instances ci
           JOIN coupons c ON c.id = ci.coupon_id
           JOIN users u ON u.id = ci.consumer_id
          WHERE ci.id = $1`,
        [tok.coupon_instance_id]
      );
      const info = ctx.rows[0];

      // Paso 5 — transferable=false ⇒ jwt consumer_id === DB consumer_id
      if (!info.transferable && jwtConsumerId !== null && Number(jwtConsumerId) !== Number(info.consumer_id)) {
        throw new AppError(403, 'NOT_TRANSFERABLE', 'Este cupón no puede ser usado por otra persona.');
      }

      // Paso 6 — UPDATE atómico del contador (AP-01)
      const couponUpd = await client.query(
        `UPDATE coupons
            SET uses_count = uses_count + 1
          WHERE id = $1 AND uses_count < total_usage_limit
          RETURNING id`,
        [info.coupon_id]
      );
      if (couponUpd.rowCount === 0) {
        // AP-03: todo rollback
        throw new AppError(409, 'COUPON_EXHAUSTED', 'Este cupón se ha agotado.');
      }

      // Post-éxito: UPDATE coupon_instances, INSERT redemptions, INSERT activity_log
      await client.query(
        `UPDATE coupon_instances
            SET uses_count = uses_count + 1, last_used_at = NOW()
          WHERE id = $1`,
        [info.instance_id]
      );

      // discount_applied depende del tipo
      const discountApplied = calcDiscountApplied(info);
      await client.query(
        `INSERT INTO redemptions
           (coupon_instance_id, business_id, consumer_id, discount_applied)
         VALUES ($1, $2, $3, $4)`,
        [info.instance_id, businessId, info.consumer_id, discountApplied]
      );

      await client.query(
        `INSERT INTO activity_logs (user_id, business_id, action, metadata)
         VALUES ($1, $2, 'coupon_scan_success', $3::jsonb)`,
        [
          userId,
          businessId,
          JSON.stringify({
            coupon_id: Number(info.coupon_id),
            coupon_instance_id: Number(info.instance_id),
            token_id: Number(tok.id),
          }),
        ]
      );

      // Limpiar rate limiter de fallos
      resetScanHistory(businessId);

      return {
        success: true,
        consumer_name: info.consumer_name,
        discount_type: info.discount_type,
        discount_value: Number(info.discount_value),
        discount_applied: Number(discountApplied),
        message: 'Cupón validado correctamente.',
      };
    });
  } catch (err) {
    // T-320: insertar alerta de reutilización fuera de la transacción rollbackeada
    if (pendingTokenReuseAlert) {
      try {
        await query(
          `INSERT INTO alerts (type, severity, description, business_id)
           VALUES ('token_reuse', 'high', $1, $2)`,
          [pendingTokenReuseAlert.description, pendingTokenReuseAlert.business_id]
        );
      } catch (alertErr) {
        logger.error('token_reuse_alert_failed', { message: alertErr.message });
      }
    }
    // Clasificar errores de usuario vs server para rate limit scanner (T-248)
    if (err instanceof AppError && err.httpStatus >= 400 && err.httpStatus < 500) {
      // No contar 429 propio como fallo (evita feedback loop)
      if (err.code !== 'SCANNER_BLOCKED') {
        await registerScanFailure(businessId);
        try {
          await query(
            `INSERT INTO activity_logs (user_id, business_id, action, metadata)
             VALUES ($1, $2, 'coupon_scan_fail', $3::jsonb)`,
            [userId, businessId, JSON.stringify({ code: err.code })]
          );
        } catch (logErr) {
          logger.error('scan_fail_log_failed', { message: logErr.message });
        }
      }
    }
    throw err;
  }
}

function calcDiscountApplied(info) {
  // Cálculo MVP: porcentaje/fijo directo, 2x1/free usa precio_referencia.
  if (info.discount_type === 'percent') {
    // Aplica al precio_referencia si existe, de lo contrario retorna el %.
    if (info.precio_referencia) {
      return (Number(info.precio_referencia) * Number(info.discount_value)) / 100;
    }
    return Number(info.discount_value);
  }
  if (info.discount_type === 'fixed') {
    return Number(info.discount_value);
  }
  if (info.discount_type === '2x1') {
    return Number(info.precio_referencia) / 2;
  }
  if (info.discount_type === 'free') {
    return Number(info.precio_referencia);
  }
  return Number(info.discount_value);
}

module.exports = {
  createCoupon,
  listMyCoupons,
  pauseCoupon,
  activateCoupon,
  saveCouponToWallet,
  generateQr,
  redeemCoupon,
  // helpers export para tests
  _sha256: sha256,
};
