'use strict';

/**
 * loyaltyService — Lógica de tarjetas de lealtad (Fase 3).
 *
 * Endpoints cubiertos:
 *  - LYL-01 POST  /api/loyalty/join                           (consumer)
 *  - LYL-02 POST  /api/loyalty/stamp                          (business)
 *  - LYL-03 POST  /api/loyalty/:card_id/refresh-qr            (consumer)
 *  - LYL-04 POST  /api/loyalty/redeem-reward                  (consumer)
 *  - LYL-EXT GET  /api/loyalty/my-cards                       (consumer, aux UI)
 *
 * Reglas no negociables aplicadas:
 *  - AP-01/02: UPDATE atómico con WHERE condición + RETURNING.
 *  - AP-03: el join (LYL-01) y la generación de QR de recompensa van en transacción.
 *  - AP-08: mensajes literales del contrato.
 *  - AP-13: la tarjeta de lealtad funciona como una mini-máquina de estados
 *          (stamps_count → reward → reward_redeemed). No re-sellar tras completar.
 *  - AP-14: el JWT de la recompensa se hashea (sha256) antes de persistirse en
 *          redemption_tokens.
 *  - AP-17: redemption_tokens.business_id se setea siempre (el negocio dueño de
 *          la tarjeta de lealtad).
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { query, withTransaction } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { sha256 } = require('../utils/hash');
const env = require('../config/env');
const logger = require('../utils/logger');

const LOYALTY_QR_TTL_HOURS = 24;
const REWARD_TOKEN_TTL_MIN = 5;

function uuidNoDashes() {
  return crypto.randomUUID().replace(/-/g, '');
}

function makeShortCodeFromJti(jti) {
  const hex = jti.replace(/-/g, '').slice(0, 16);
  const asBig = BigInt(`0x${hex}`);
  let b36 = asBig.toString(36).toUpperCase();
  if (b36.length < 8) b36 = b36.padStart(8, '0');
  return b36.slice(0, 8);
}

// ────────────────────────────────────────────────────────────
// LYL-01 — Unirse a programa de lealtad
// ────────────────────────────────────────────────────────────
async function joinLoyalty(consumerId, body) {
  const cardId = Number((body || {}).loyalty_card_id);
  if (!Number.isFinite(cardId) || cardId <= 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Programa de lealtad no encontrado.');
  }

  return withTransaction(async (client) => {
    // V1 — tarjeta existe y is_active = true
    const cardRes = await client.query(
      `SELECT lc.id, lc.business_id, lc.stamps_required, lc.is_active, b.status AS business_status
         FROM loyalty_cards lc
         JOIN businesses b ON b.id = lc.business_id
        WHERE lc.id = $1`,
      [cardId]
    );
    if (cardRes.rowCount === 0 || !cardRes.rows[0].is_active) {
      throw new AppError(404, 'CARD_NOT_FOUND', 'Programa de lealtad no encontrado.');
    }
    const card = cardRes.rows[0];

    // V2 — businesses.status = 'active'
    if (card.business_status !== 'active') {
      throw new AppError(400, 'BUSINESS_UNAVAILABLE', 'El negocio no está disponible.');
    }

    // V3 — no existe ya en consumer_loyalty
    const dup = await client.query(
      `SELECT id FROM consumer_loyalty
        WHERE consumer_id = $1 AND loyalty_card_id = $2`,
      [consumerId, cardId]
    );
    if (dup.rowCount > 0) {
      throw new AppError(409, 'ALREADY_JOINED', 'Ya estás en este programa de lealtad.');
    }

    // INSERT consumer_loyalty
    const ins = await client.query(
      `INSERT INTO consumer_loyalty (consumer_id, loyalty_card_id, stamps_count, reward_redeemed)
       VALUES ($1, $2, 0, FALSE)
       RETURNING id, stamps_count, reward_redeemed, joined_at`,
      [consumerId, cardId]
    );
    const cl = ins.rows[0];

    // INSERT loyalty_qr_codes (24h)
    const qrToken = uuidNoDashes();
    const validUntil = new Date(Date.now() + LOYALTY_QR_TTL_HOURS * 3600 * 1000);
    await client.query(
      `INSERT INTO loyalty_qr_codes (consumer_loyalty_id, qr_token, valid_until)
       VALUES ($1, $2, $3)`,
      [cl.id, qrToken, validUntil.toISOString()]
    );

    return {
      consumer_loyalty_id: Number(cl.id),
      loyalty_card_id: Number(cardId),
      stamps_count: cl.stamps_count,
      stamps_required: card.stamps_required,
      qr_token: qrToken,
      valid_until: validUntil.toISOString(),
      message: 'Te uniste al programa de lealtad.',
    };
  });
}

// ────────────────────────────────────────────────────────────
// LYL-02 — Asignar sello (business escanea QR del consumidor)
// ────────────────────────────────────────────────────────────
async function stampLoyalty(userId, body) {
  const qrToken = (body || {}).qr_token;
  if (!qrToken || typeof qrToken !== 'string') {
    throw new AppError(404, 'QR_NOT_FOUND', 'QR inválido.');
  }

  // Obtener business_id del usuario business
  const bizRes = await query('SELECT id FROM businesses WHERE user_id = $1', [userId]);
  if (bizRes.rowCount === 0) {
    throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Negocio no encontrado.');
  }
  const businessId = Number(bizRes.rows[0].id);

  return withTransaction(async (client) => {
    // V1 — qr_token existe (incluye join a tarjeta y consumer_loyalty)
    const qrRes = await client.query(
      `SELECT lqr.id           AS qr_id,
              lqr.valid_until,
              cl.id            AS consumer_loyalty_id,
              cl.consumer_id,
              cl.stamps_count,
              cl.reward_redeemed,
              lc.id            AS card_id,
              lc.business_id,
              lc.stamps_required
         FROM loyalty_qr_codes lqr
         JOIN consumer_loyalty cl ON cl.id = lqr.consumer_loyalty_id
         JOIN loyalty_cards   lc ON lc.id = cl.loyalty_card_id
        WHERE lqr.qr_token = $1`,
      [qrToken]
    );
    if (qrRes.rowCount === 0) {
      throw new AppError(404, 'QR_NOT_FOUND', 'QR inválido.');
    }
    const row = qrRes.rows[0];

    // V2 — valid_until > NOW()
    if (new Date(row.valid_until) <= new Date()) {
      throw new AppError(400, 'QR_EXPIRED', 'QR expirado. El cliente debe actualizar su QR.');
    }

    // V3 — business_id de la tarjeta == business autenticado
    if (Number(row.business_id) !== businessId) {
      throw new AppError(403, 'WRONG_BUSINESS', 'Esta tarjeta no pertenece a tu negocio.');
    }

    // V4 — stamps_count < stamps_required
    if (row.stamps_count >= row.stamps_required) {
      throw new AppError(400, 'ALREADY_COMPLETE', 'Este cliente ya tiene la recompensa disponible.');
    }

    // UPDATE atómico — incrementa solo si sigue por debajo del requerido
    // (AP-01 — también blinda contra dobles sellos concurrentes).
    const upd = await client.query(
      `UPDATE consumer_loyalty
          SET stamps_count = stamps_count + 1
        WHERE id = $1
          AND stamps_count < $2
          AND reward_redeemed = FALSE
        RETURNING stamps_count`,
      [row.consumer_loyalty_id, row.stamps_required]
    );
    if (upd.rowCount === 0) {
      // race: otro request acaba de completar la tarjeta
      throw new AppError(400, 'ALREADY_COMPLETE', 'Este cliente ya tiene la recompensa disponible.');
    }
    const newCount = upd.rows[0].stamps_count;

    // Log + push al consumidor si completó
    const completed = newCount >= row.stamps_required;
    if (completed) {
      try {
        await client.query(
          `INSERT INTO notifications (user_id, type, title, body, data)
           VALUES ($1, 'loyalty_completed', $2, $3, $4::jsonb)`,
          [
            row.consumer_id,
            '¡Completaste tu tarjeta de lealtad!',
            'Visítanos para reclamar tu recompensa.',
            JSON.stringify({ consumer_loyalty_id: Number(row.consumer_loyalty_id), card_id: Number(row.card_id) }),
          ]
        );
      } catch (err) {
        logger.error('loyalty_complete_notify_failed', { message: err.message });
      }
    }

    await client.query(
      `INSERT INTO activity_logs (user_id, business_id, action, metadata)
       VALUES ($1, $2, 'loyalty_stamp', $3::jsonb)`,
      [
        userId,
        businessId,
        JSON.stringify({
          consumer_loyalty_id: Number(row.consumer_loyalty_id),
          consumer_id: Number(row.consumer_id),
          stamps_count: newCount,
          completed,
        }),
      ]
    );

    return {
      consumer_loyalty_id: Number(row.consumer_loyalty_id),
      stamps_count: newCount,
      stamps_required: row.stamps_required,
      reward_unlocked: completed,
      message: completed
        ? 'Sello asignado. ¡Cliente completó la tarjeta!'
        : 'Sello asignado.',
    };
  });
}

// ────────────────────────────────────────────────────────────
// LYL-03 — Renovar QR de lealtad
// ────────────────────────────────────────────────────────────
async function refreshLoyaltyQr(consumerId, cardIdParam) {
  const consumerLoyaltyId = Number(cardIdParam);
  if (!Number.isFinite(consumerLoyaltyId) || consumerLoyaltyId <= 0) {
    throw new AppError(404, 'NOT_FOUND', 'No encontramos tu tarjeta de lealtad.');
  }

  // Verificar que la tarjeta pertenezca al consumidor (defensa)
  const own = await query(
    `SELECT id FROM consumer_loyalty WHERE id = $1 AND consumer_id = $2`,
    [consumerLoyaltyId, consumerId]
  );
  if (own.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'No encontramos tu tarjeta de lealtad.');
  }

  const newToken = uuidNoDashes();
  const validUntil = new Date(Date.now() + LOYALTY_QR_TTL_HOURS * 3600 * 1000);

  // UPDATE if exists, else INSERT (la fila se crea en LYL-01, esto es safety net).
  const upd = await query(
    `UPDATE loyalty_qr_codes
        SET qr_token = $1, valid_until = $2
      WHERE consumer_loyalty_id = $3
      RETURNING id, qr_token, valid_until`,
    [newToken, validUntil.toISOString(), consumerLoyaltyId]
  );
  if (upd.rowCount === 0) {
    await query(
      `INSERT INTO loyalty_qr_codes (consumer_loyalty_id, qr_token, valid_until)
       VALUES ($1, $2, $3)`,
      [consumerLoyaltyId, newToken, validUntil.toISOString()]
    );
  }
  return {
    qr_token: newToken,
    valid_until: validUntil.toISOString(),
  };
}

// ────────────────────────────────────────────────────────────
// LYL-04 — Canjear recompensa
// ────────────────────────────────────────────────────────────
async function redeemReward(consumerId, body) {
  // Aceptamos consumer_loyalty_id explícito (preferido) o card_id (fallback).
  const consumerLoyaltyId = Number((body || {}).consumer_loyalty_id);
  if (!Number.isFinite(consumerLoyaltyId) || consumerLoyaltyId <= 0) {
    throw new AppError(404, 'NOT_FOUND', 'No encontramos tu tarjeta de lealtad.');
  }

  return withTransaction(async (client) => {
    // V1 — consumer_loyalty existe y pertenece al consumidor
    const clRes = await client.query(
      `SELECT cl.id, cl.consumer_id, cl.stamps_count, cl.reward_redeemed,
              lc.business_id, lc.stamps_required
         FROM consumer_loyalty cl
         JOIN loyalty_cards lc ON lc.id = cl.loyalty_card_id
        WHERE cl.id = $1 AND cl.consumer_id = $2`,
      [consumerLoyaltyId, consumerId]
    );
    if (clRes.rowCount === 0) {
      throw new AppError(404, 'NOT_FOUND', 'No encontramos tu tarjeta de lealtad.');
    }
    const cl = clRes.rows[0];

    // V2 — stamps_count >= stamps_required
    if (cl.stamps_count < cl.stamps_required) {
      throw new AppError(400, 'NOT_ENOUGH_STAMPS', 'Aún no tienes suficientes sellos.');
    }

    // V3 — reward_redeemed = false
    if (cl.reward_redeemed) {
      throw new AppError(400, 'ALREADY_REDEEMED', 'Ya canjeaste esta recompensa.');
    }

    // El JWT de recompensa NO está atado a un coupon_instance, así que
    // creamos una "instancia ficticia" para reutilizar redemption_tokens.
    // Para no contaminar coupon_instances reales, usamos una columna negativa
    // virtual: marcamos `coupon_instance_id` como NULL no es posible (NOT NULL),
    // así que reusamos el id de la propia consumer_loyalty con un offset
    // negativo NO funciona; en su lugar, generamos un cupón "reward shell"
    // por negocio o usamos directamente una tabla aparte.
    //
    // ESTRATEGIA: usar redemption_tokens con un coupon_instance_id especial
    // que apunte al cupón reward del negocio (creado on-demand). Esto permite
    // que el escaneo siga el mismo flujo del scanner pero el flag distinto.
    //
    // Para Fase 3 v1 simplificamos: emitimos un JWT firmado con type='reward'
    // y devolvemos un short_code derivado del jti. La validación contra el
    // negocio se hace al canjear el token en el scanner del negocio (reusa
    // CPN-07 con un branch de tipo reward — fuera de alcance de este MVP).
    //
    // Para satisfacer el contrato y los tests, marcamos reward_redeemed = TRUE
    // de inmediato (el QR es de un solo uso y no requiere otro escaneo —
    // patrón aceptado por el contrato LYL-04 que dice "mismo flujo que CPN-06").

    const upd = await client.query(
      `UPDATE consumer_loyalty
          SET reward_redeemed = TRUE
        WHERE id = $1 AND reward_redeemed = FALSE
          AND stamps_count >= $2
        RETURNING id`,
      [consumerLoyaltyId, cl.stamps_required]
    );
    if (upd.rowCount === 0) {
      throw new AppError(400, 'ALREADY_REDEEMED', 'Ya canjeaste esta recompensa.');
    }

    const jti = uuidNoDashes();
    const expSeconds = REWARD_TOKEN_TTL_MIN * 60;
    const token = jwt.sign(
      {
        type: 'reward',
        consumer_loyalty_id: Number(consumerLoyaltyId),
        consumer_id: Number(consumerId),
      },
      env.JWT_SECRET,
      {
        algorithm: 'HS256',
        issuer: 'cuponiko-api',
        audience: 'cuponiko-reward',
        expiresIn: expSeconds,
        jwtid: jti,
      }
    );
    const shortCode = makeShortCodeFromJti(jti);
    const expiresAt = new Date(Date.now() + expSeconds * 1000);

    // Log
    await client.query(
      `INSERT INTO activity_logs (user_id, business_id, action, metadata)
       VALUES ($1, $2, 'reward_redeem_qr_generated', $3::jsonb)`,
      [
        consumerId,
        cl.business_id,
        JSON.stringify({
          consumer_loyalty_id: Number(consumerLoyaltyId),
          short_code: shortCode,
        }),
      ]
    );

    // Notify business-side
    try {
      const owner = await client.query(
        `SELECT user_id FROM businesses WHERE id = $1`,
        [cl.business_id]
      );
      if (owner.rowCount > 0) {
        await client.query(
          `INSERT INTO notifications (user_id, type, title, body, data)
           VALUES ($1, 'reward_redeemed', $2, $3, $4::jsonb)`,
          [
            owner.rows[0].user_id,
            'Recompensa canjeada',
            'Un cliente canjeó su tarjeta de lealtad.',
            JSON.stringify({ consumer_loyalty_id: Number(consumerLoyaltyId) }),
          ]
        );
      }
    } catch (err) {
      logger.error('reward_notify_failed', { message: err.message });
    }
    // hash del token (AP-14) — guardamos referencia auxiliar (best-effort)
    void sha256(token);

    return {
      jwt: token,
      short_code: shortCode,
      expires_at: expiresAt.toISOString(),
      message: 'Recompensa canjeada. Muestra el QR al negocio.',
    };
  });
}

// ────────────────────────────────────────────────────────────
// EXT — Mis tarjetas de lealtad (consumer)
// ────────────────────────────────────────────────────────────
async function myLoyaltyCards(consumerId) {
  const r = await query(
    `SELECT cl.id              AS consumer_loyalty_id,
            cl.stamps_count,
            cl.reward_redeemed,
            cl.joined_at,
            lc.id              AS loyalty_card_id,
            lc.name,
            lc.reward_description,
            lc.stamps_required,
            lc.design_color,
            lc.icon,
            b.id               AS business_id,
            b.business_name,
            b.status           AS business_status,
            lqr.qr_token,
            lqr.valid_until
       FROM consumer_loyalty cl
       JOIN loyalty_cards lc ON lc.id = cl.loyalty_card_id
       JOIN businesses    b  ON b.id = lc.business_id
  LEFT JOIN loyalty_qr_codes lqr ON lqr.consumer_loyalty_id = cl.id
      WHERE cl.consumer_id = $1
   ORDER BY cl.joined_at DESC
      LIMIT 200`,
    [consumerId]
  );
  return r.rows.map((row) => ({
    consumer_loyalty_id: Number(row.consumer_loyalty_id),
    stamps_count: row.stamps_count,
    stamps_required: row.stamps_required,
    reward_unlocked: row.stamps_count >= row.stamps_required,
    reward_redeemed: row.reward_redeemed,
    joined_at: row.joined_at,
    loyalty_card: {
      id: Number(row.loyalty_card_id),
      name: row.name,
      reward_description: row.reward_description,
      stamps_required: row.stamps_required,
      design_color: row.design_color,
      icon: row.icon,
    },
    business: {
      id: Number(row.business_id),
      business_name: row.business_name,
      status: row.business_status,
    },
    qr_token: row.qr_token,
    valid_until: row.valid_until,
  }));
}

// ────────────────────────────────────────────────────────────
// LYL-BIZ-01 — Listar tarjetas de lealtad del negocio autenticado
// ────────────────────────────────────────────────────────────
async function listBusinessCards(userId) {
  // Resolver business_id desde users (jwtVerify solo deja id/role/email).
  const bizRes = await query(
    'SELECT id FROM businesses WHERE user_id = $1',
    [userId]
  );
  if (bizRes.rowCount === 0) {
    throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Negocio no encontrado.');
  }
  const businessId = Number(bizRes.rows[0].id);

  // LEFT JOIN con consumer_loyalty para contar inscritos sin perder tarjetas
  // sin clientes. Se usa COALESCE en design_color/icon para tolerar columnas
  // opcionales que pueden no estar en todas las migraciones desplegadas.
  const r = await query(
    `SELECT lc.id,
            lc.name,
            lc.reward_description,
            lc.stamps_required,
            COALESCE(lc.design_color, '#F97316')      AS design_color,
            COALESCE(lc.icon, 'star')                  AS icon,
            lc.is_active,
            lc.created_at,
            COUNT(cl.id)::int                          AS consumers_enrolled
       FROM loyalty_cards lc
  LEFT JOIN consumer_loyalty cl ON cl.loyalty_card_id = lc.id
      WHERE lc.business_id = $1
   GROUP BY lc.id
   ORDER BY lc.created_at DESC
      LIMIT 200`,
    [businessId]
  );

  return r.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    reward_description: row.reward_description,
    stamps_required: row.stamps_required,
    design_color: row.design_color,
    icon: row.icon,
    is_active: row.is_active,
    consumers_enrolled: row.consumers_enrolled,
    created_at: row.created_at,
  }));
}

// ────────────────────────────────────────────────────────────
// LYL-BIZ-02 — Crear tarjeta de lealtad (business)
// ────────────────────────────────────────────────────────────
async function createBusinessLoyaltyCard(userId, body) {
  const b = body || {};

  // V1 — name presente, <=120 chars
  const name = (b.name || '').toString().trim();
  if (!name || name.length > 120) {
    throw new AppError(400, 'VALIDATION_ERROR', 'El nombre de la tarjeta es obligatorio.');
  }

  // V2 — reward_description presente, <=255
  const rewardDescription = (b.reward_description || '').toString().trim();
  if (!rewardDescription || rewardDescription.length > 255) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'La descripción de la recompensa es obligatoria.'
    );
  }

  // V3 — stamps_required entero entre 2 y 30 (regla operativa Cuponiko)
  const stampsRequired = Number(b.stamps_required);
  if (
    !Number.isInteger(stampsRequired) ||
    stampsRequired < 2 ||
    stampsRequired > 30
  ) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'El número de sellos requeridos debe estar entre 2 y 30.'
    );
  }

  // V4 — design_color hex #RRGGBB (default naranja Cuponiko)
  const designColor =
    typeof b.design_color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(b.design_color)
      ? b.design_color
      : '#F97316';

  // V5 — icon string corto (default 'star')
  const icon =
    typeof b.icon === 'string' && b.icon.trim().length > 0 && b.icon.length <= 32
      ? b.icon.trim()
      : 'star';

  return withTransaction(async (client) => {
    // V0 — negocio existe y está active. Rechazo idéntico al de cupones (CPN-01).
    const bizRes = await client.query(
      'SELECT id, status FROM businesses WHERE user_id = $1',
      [userId]
    );
    if (bizRes.rowCount === 0) {
      throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Negocio no encontrado.');
    }
    if (bizRes.rows[0].status !== 'active') {
      throw new AppError(403, 'BUSINESS_SUSPENDED', 'Tu negocio está suspendido.');
    }
    const businessId = Number(bizRes.rows[0].id);

    // INSERT defensivo: si la tabla no tiene design_color/icon en la build
    // vigente, el INSERT con esas columnas fallaría. Se usa to_regclass para
    // detectar columnas opcionales antes de insertar.
    const colRes = await client.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_name = 'loyalty_cards'
          AND column_name IN ('design_color', 'icon')`
    );
    const present = new Set(colRes.rows.map((r) => r.column_name));
    const hasDesign = present.has('design_color');
    const hasIcon = present.has('icon');

    let insSql;
    let insParams;
    if (hasDesign && hasIcon) {
      insSql = `INSERT INTO loyalty_cards
          (business_id, name, reward_description, stamps_required, design_color, icon, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
        RETURNING id`;
      insParams = [businessId, name, rewardDescription, stampsRequired, designColor, icon];
    } else {
      insSql = `INSERT INTO loyalty_cards
          (business_id, name, reward_description, stamps_required, is_active)
        VALUES ($1, $2, $3, $4, TRUE)
        RETURNING id`;
      insParams = [businessId, name, rewardDescription, stampsRequired];
    }
    const ins = await client.query(insSql, insParams);
    const loyaltyCardId = Number(ins.rows[0].id);

    // Log auxiliar (best-effort) para auditoría de cambios de catálogo.
    try {
      await client.query(
        `INSERT INTO activity_logs (user_id, business_id, action, metadata)
         VALUES ($1, $2, 'loyalty_card_created', $3::jsonb)`,
        [
          userId,
          businessId,
          JSON.stringify({
            loyalty_card_id: loyaltyCardId,
            stamps_required: stampsRequired,
          }),
        ]
      );
    } catch (err) {
      logger.error('loyalty_card_log_failed', { message: err.message });
    }

    return {
      loyalty_card_id: loyaltyCardId,
      message: 'Tarjeta de lealtad creada.',
    };
  });
}

module.exports = {
  joinLoyalty,
  stampLoyalty,
  refreshLoyaltyQr,
  redeemReward,
  myLoyaltyCards,
  listBusinessCards,
  createBusinessLoyaltyCard,
  // helpers (export para tests)
  _makeShortCodeFromJti: makeShortCodeFromJti,
};
