'use strict';

/**
 * notificationsService — implementa NOTIFY-01..04 de cuponiko_contratos_api_v2.md
 *
 * Analogía: el centro de mensajería del centro comercial. Cada local (negocio)
 * tiene una bandeja de salida; cada visitante (consumer/business) tiene una
 * bandeja de entrada. Aquí leemos su buzón (NOTIFY-01), marcamos sobres como
 * leídos (NOTIFY-02), registramos su número de localizador (push token —
 * NOTIFY-03) y permitimos que el local mande una circular a su segmento de
 * clientes (NOTIFY-04, solo plan Premium con tope de 3 envíos por día).
 *
 * Reglas críticas honradas:
 *  - AP-08: mensajes literales del contrato.
 *  - AP-04: push_token tiene UNIQUE implícito por device, así que al asignar
 *    a otro user limpiamos el anterior con UPDATE atómico.
 *  - Rate limit propio (3/24h) calculado en `activity_logs` con
 *    action='notification_sent'.
 */

const { query, withTransaction } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { getBusinessByUserId } = require('../middleware/planChecker');
const env = require('../config/env');
const logger = require('../utils/logger');

// ────────────────────────────────────────────────────────────
// NOTIFY-01: GET /api/notifications
// ────────────────────────────────────────────────────────────
async function listNotifications(userId, { page = 1, limit = 20, unreadOnly = false } = {}) {
  // Validación 1: limit ≤ 50
  const lim = Math.max(1, Number(limit) || 20);
  if (lim > 50) {
    throw new AppError(400, 'VALIDATION_ERROR', 'El límite máximo es 50 notificaciones por página.');
  }
  const pg = Math.max(1, Number(page) || 1);
  const offset = (pg - 1) * lim;
  const onlyUnread = unreadOnly === true || unreadOnly === 'true' || unreadOnly === 1 || unreadOnly === '1';

  const totalRes = await query(
    `SELECT COUNT(*)::int AS total
       FROM notifications
      WHERE user_id = $1
        AND ($2::boolean IS FALSE OR read = false)`,
    [userId, onlyUnread]
  );
  const total = totalRes.rows[0].total;

  const rowsRes = await query(
    `SELECT id, type, title, body, data, read, created_at
       FROM notifications
      WHERE user_id = $1
        AND ($2::boolean IS FALSE OR read = false)
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4`,
    [userId, onlyUnread, lim, offset]
  );

  return {
    notifications: rowsRes.rows.map((r) => ({
      id: Number(r.id),
      type: r.type,
      title: r.title,
      body: r.body,
      data: r.data,
      read: r.read,
      created_at: r.created_at,
    })),
    pagination: {
      page: pg,
      limit: lim,
      total,
      total_pages: lim > 0 ? Math.ceil(total / lim) : 0,
    },
  };
}

// ────────────────────────────────────────────────────────────
// NOTIFY-02: PATCH /api/notifications/:id/read
// AP-01: UPDATE atómico con WHERE compuesto + RETURNING.
// Si rowCount=0, distinguir 404 vs 403 con un SELECT post-fallo (es un caso
// frío de error, no afecta la atomicidad del happy path).
// ────────────────────────────────────────────────────────────
async function markRead(notificationId, userId) {
  const id = Number(notificationId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(404, 'NOT_FOUND', 'Notificación no encontrada.');
  }
  const r = await query(
    `UPDATE notifications
        SET read = true
      WHERE id = $1 AND user_id = $2
      RETURNING id`,
    [id, userId]
  );
  if (r.rowCount === 0) {
    const exists = await query(`SELECT user_id FROM notifications WHERE id = $1`, [id]);
    if (exists.rowCount === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Notificación no encontrada.');
    }
    throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para modificar esta notificación.');
  }
  return { id, read: true };
}

// ────────────────────────────────────────────────────────────
// NOTIFY-03: POST /api/push/token
// AP-04: el push_token es único por device. Si otro user ya lo tenía,
// limpiarlo primero (un device pertenece a un único user activo).
// ────────────────────────────────────────────────────────────
async function registerPushToken(userId, { push_token, platform }) {
  if (!push_token || typeof push_token !== 'string' || !push_token.trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Push token es requerido.');
  }
  if (platform !== 'ios' && platform !== 'android') {
    throw new AppError(400, 'VALIDATION_ERROR', "Plataforma debe ser 'ios' o 'android'.");
  }
  const token = push_token.trim();

  await withTransaction(async (client) => {
    // Paso 1 — desvincular de cualquier OTRO user que lo tenga
    await client.query(
      `UPDATE users SET push_token = NULL, updated_at = NOW()
        WHERE push_token = $1 AND id <> $2`,
      [token, userId]
    );
    // Paso 2 — asignar al user actual
    await client.query(
      `UPDATE users SET push_token = $1, updated_at = NOW() WHERE id = $2`,
      [token, userId]
    );
  });

  return { push_token_saved: true };
}

// ────────────────────────────────────────────────────────────
// NOTIFY-04: POST /api/notifications/send (solo Premium, 3/24h)
// ────────────────────────────────────────────────────────────
const VALID_SEGMENTS = ['all', 'active', 'inactive', 'frequent'];

function _segmentSql(segment) {
  // Devuelve un fragmento WHERE adicional aplicado sobre subconsulta de
  // consumers relacionados al negocio.
  // Base de "consumer relacionado" = tiene coupon_instance de algún cupón del
  // negocio O tiene consumer_loyalty con loyalty_card del negocio.
  // "Última interacción" = MAX entre redemptions.redeemed_at y coupon_instances.saved_at
  switch (segment) {
    case 'all':
      return '';
    case 'active':
      return `AND last_interaction >= NOW() - INTERVAL '30 days'`;
    case 'inactive':
      return `AND last_interaction < NOW() - INTERVAL '30 days'`;
    case 'frequent':
      // ≥3 interacciones (redemptions + saves) en últimos 30 días
      return `AND interactions_30d >= 3`;
    default:
      return '';
  }
}

async function sendToSegment(userId, { segment, title, body, data }) {
  // Validación 1 — plan Premium (también valida que el user tiene un negocio)
  const business = await getBusinessByUserId({ query }, userId);
  if (business.plan !== 'premium') {
    throw new AppError(
      403,
      'PLAN_RESTRICTED',
      'El envío de notificaciones está disponible en el plan Premium.'
    );
  }

  // Validación 2 — segmento permitido
  if (!segment || !VALID_SEGMENTS.includes(segment)) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Segmento inválido. Opciones: all, active, inactive, frequent.'
    );
  }

  // Validación 3 — title presente y ≤ 100
  if (!title || typeof title !== 'string' || !title.trim() || title.length > 100) {
    throw new AppError(400, 'VALIDATION_ERROR', 'El título es requerido (máximo 100 caracteres).');
  }

  // Validación 4 — body presente y ≤ 500
  if (!body || typeof body !== 'string' || !body.trim() || body.length > 500) {
    throw new AppError(400, 'VALIDATION_ERROR', 'El mensaje es requerido (máximo 500 caracteres).');
  }

  // Validación 5 — rate limit 3 envíos / 24h por negocio
  const sentRes = await query(
    `SELECT COUNT(*)::int AS n
       FROM activity_logs
      WHERE business_id = $1
        AND action = 'notification_sent'
        AND created_at > NOW() - INTERVAL '24 hours'`,
    [business.id]
  );
  if (sentRes.rows[0].n >= 3) {
    throw new AppError(
      429,
      'NOTIFICATION_LIMIT',
      'Límite de notificaciones alcanzado. Máximo 3 por día.'
    );
  }

  // Resolver consumers según segmento.
  // Subconsulta común: relación negocio-consumer + métricas de interacción
  const segmentFilter = _segmentSql(segment);
  const recipientsRes = await query(
    `WITH related AS (
       SELECT u.id AS consumer_id,
              u.push_token,
              u.email_verified,
              u.email,
              GREATEST(
                COALESCE(MAX(r.redeemed_at), 'epoch'::timestamptz),
                COALESCE(MAX(ci.saved_at), 'epoch'::timestamptz),
                COALESCE(MAX(cl.joined_at), 'epoch'::timestamptz)
              ) AS last_interaction,
              (
                SELECT COUNT(*) FROM redemptions r2
                  WHERE r2.business_id = $1
                    AND r2.consumer_id = u.id
                    AND r2.redeemed_at >= NOW() - INTERVAL '30 days'
              )
              + (
                SELECT COUNT(*) FROM coupon_instances ci2
                  JOIN coupons c2 ON c2.id = ci2.coupon_id
                  WHERE c2.business_id = $1
                    AND ci2.consumer_id = u.id
                    AND ci2.saved_at >= NOW() - INTERVAL '30 days'
              ) AS interactions_30d
         FROM users u
         LEFT JOIN coupon_instances ci ON ci.consumer_id = u.id
         LEFT JOIN coupons c ON c.id = ci.coupon_id AND c.business_id = $1
         LEFT JOIN consumer_loyalty cl ON cl.consumer_id = u.id
         LEFT JOIN loyalty_cards lc ON lc.id = cl.loyalty_card_id AND lc.business_id = $1
         LEFT JOIN redemptions r ON r.consumer_id = u.id AND r.business_id = $1
        WHERE u.role = 'consumer'
          AND u.is_active = true
          AND (c.business_id = $1 OR lc.business_id = $1 OR r.business_id = $1)
        GROUP BY u.id, u.push_token, u.email_verified, u.email
     )
     SELECT consumer_id, push_token, email_verified, email
       FROM related
      WHERE 1=1 ${segmentFilter}`,
    [business.id]
  );

  const recipients = recipientsRes.rows;

  if (recipients.length === 0) {
    // Aún registramos el evento para honrar el rate limit (intento contado)
    await query(
      `INSERT INTO activity_logs (user_id, business_id, action, metadata)
       VALUES ($1, $2, 'notification_sent', $3::jsonb)`,
      [userId, business.id, JSON.stringify({ segment, sent_to: 0, recipients_total: 0 })]
    );
    return { sent_to: 0, segment, message: 'Notificación enviada a 0 usuarios.' };
  }

  const payload = data && typeof data === 'object' ? data : {};

  // Persistir 1 notification por destinatario en una sola transacción
  await withTransaction(async (client) => {
    const insertText = `INSERT INTO notifications (user_id, type, title, body, data)
                        VALUES ($1, 'business_broadcast', $2, $3, $4::jsonb)`;
    for (const rec of recipients) {
      await client.query(insertText, [rec.consumer_id, title, body, JSON.stringify(payload)]);
    }
    await client.query(
      `INSERT INTO activity_logs (user_id, business_id, action, metadata)
       VALUES ($1, $2, 'notification_sent', $3::jsonb)`,
      [
        userId,
        business.id,
        JSON.stringify({
          segment,
          sent_to: recipients.length,
          recipients_with_push: recipients.filter((r) => r.push_token).length,
        }),
      ]
    );
  });

  // Side-effect: push real (mock en tests). Lo hacemos fuera de la transacción.
  const pushRecipients = recipients.filter((r) => r.push_token);
  if (pushRecipients.length > 0 && !env.MOCK_EXTERNAL_SERVICES) {
    // Producción: integrar expo-server-sdk con batches de 100. Aquí solo log
    // para no introducir nueva dep en este patch.
    logger.info('push_send_pending', { count: pushRecipients.length });
  } else if (pushRecipients.length > 0) {
    logger.info('push_send_mock', { count: pushRecipients.length, segment });
  }

  return {
    sent_to: recipients.length,
    segment,
    message: `Notificación enviada a ${recipients.length} usuarios.`,
  };
}

module.exports = {
  listNotifications,
  markRead,
  registerPushToken,
  sendToSegment,
};
