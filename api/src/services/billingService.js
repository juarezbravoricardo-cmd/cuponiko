'use strict';

/**
 * Servicio de Billing — BILL-01 y BILL-02.
 *
 * Regla AP-07: webhook DEBE ser idempotente vía `stripe_events`.
 *              INSERT ... ON CONFLICT DO NOTHING; rowCount=0 → 200 sin acción.
 *
 * Regla AP-12 (downgrade): pausar cupones en orden created_at DESC hasta dejar
 *              máximo 1 activo (límite del plan Gratuito v2). Los pausados
 *              usan status='paused_by_downgrade'.
 *
 * Todo el procesamiento del webhook corre dentro de una transacción (AP-03).
 */

const { query, withTransaction } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { createCheckoutSession, verifyWebhookSignature } = require('./stripe');
const logger = require('../utils/logger');
const { invalidateBusinessCaches } = require('./cacheService');

// ─────────────────────────────────────────────────────────────
// BILL-01
// ─────────────────────────────────────────────────────────────
const VALID_BILLING_INTERVALS = ['monthly', 'quarterly'];

async function createBusinessCheckoutSession({ userId, billingInterval }) {
  // Pricing v2: el cliente debe enviar billing_interval ('monthly' o 'quarterly').
  if (!VALID_BILLING_INTERVALS.includes(billingInterval)) {
    throw new AppError(400, 'INVALID_INTERVAL', 'Intervalo de facturación no válido.');
  }

  const res = await query(
    `SELECT b.id, b.plan, b.status, b.stripe_customer_id, u.email
       FROM businesses b
       JOIN users u ON u.id = b.user_id
      WHERE b.user_id = $1`,
    [userId]
  );
  if (res.rowCount === 0) {
    throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Negocio no encontrado.');
  }
  const b = res.rows[0];

  if (b.plan === 'premium') {
    throw new AppError(400, 'ALREADY_PREMIUM', 'Ya tienes plan Premium activo.');
  }
  if (b.status !== 'active') {
    throw new AppError(403, 'BUSINESS_SUSPENDED', 'Tu negocio está suspendido. Contacta soporte.');
  }

  const session = await createCheckoutSession({
    businessId: b.id,
    email: b.email,
    customerId: b.stripe_customer_id || null,
    billingInterval,
  });

  // Persistir stripe_customer_id si Stripe lo creó
  if (session.customer_id && !b.stripe_customer_id) {
    await query(
      'UPDATE businesses SET stripe_customer_id = $1 WHERE id = $2',
      [session.customer_id, b.id]
    );
  }

  return { checkout_url: session.url, session_id: session.id };
}

// ─────────────────────────────────────────────────────────────
// BILL-02 — Webhook handler
// ─────────────────────────────────────────────────────────────

/**
 * Procesa el evento verificado. Devuelve { received, duplicate?, handled? }.
 * rawBody debe ser Buffer (Express express.raw).
 */
async function handleWebhook({ rawBody, signature }) {
  const event = verifyWebhookSignature(rawBody, signature);
  const eventId = event.id;
  const eventType = event.type;

  // Idempotencia atómica — regla AP-07
  const ins = await query(
    `INSERT INTO stripe_events (stripe_event_id, event_type)
     VALUES ($1, $2)
     ON CONFLICT (stripe_event_id) DO NOTHING
     RETURNING stripe_event_id`,
    [eventId, eventType]
  );
  if (ins.rowCount === 0) {
    logger.info('stripe_webhook_duplicate', { event_id: eventId, type: eventType });
    return { received: true, duplicate: true };
  }

  try {
    switch (eventType) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event);
        break;
      default:
        logger.info('stripe_webhook_unhandled_type', { type: eventType });
    }
    return { received: true, handled: true };
  } catch (err) {
    // Si el handler falla DESPUÉS de registrar el evento, eliminamos el registro
    // para permitir reprocesamiento en el próximo reintento de Stripe.
    await query('DELETE FROM stripe_events WHERE stripe_event_id = $1', [eventId]).catch(
      () => {}
    );
    throw err;
  }
}

async function handleCheckoutCompleted(event) {
  const session = event.data?.object || {};
  const metadata = session.metadata || {};
  const businessId = Number(metadata.business_id);
  const subscriptionId = session.subscription || null;
  const customerId = session.customer || null;

  if (!businessId) {
    logger.warn('stripe_checkout_no_business_id', { session_id: session.id });
    return;
  }

  // ── Pago de anuncio ──
  if (metadata.type === 'ad_payment' && metadata.ad_id) {
    const adId = Number(metadata.ad_id);
    const days = Number(metadata.package_days) || 7;
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);
    const startStr = startDate.toISOString().slice(0, 10);
    const endStr = endDate.toISOString().slice(0, 10);

    await query(
      `UPDATE anuncios_pagados SET status = 'active', start_date = $2, end_date = $3 WHERE id = $1 AND status = 'pending_payment'`,
      [adId, startStr, endStr]
    );
    await query(
      `UPDATE coupons SET status = 'active', start_date = $2, end_date = $3 FROM anuncios_pagados ap WHERE coupons.id = ap.coupon_id AND ap.id = $1`,
      [adId, startStr, endStr]
    );
    console.log(`[webhook] Ad ${adId} activated: ${startStr} → ${endStr} (${days} days)`);
    return;
  }
  // ── Resto de la lógica de suscripción existente (NO TOCAR) ──

  // Pricing v2: leer billing_interval del metadata; default 'monthly' si no viene (edge case).
  const rawInterval = metadata.billing_interval;
  const billingInterval = rawInterval === 'quarterly' ? 'quarterly' : 'monthly';

  await withTransaction(async (client) => {
    const upd = await client.query(
      `UPDATE businesses
          SET plan = 'premium',
              subscription_status = 'active',
              stripe_subscription_id = COALESCE($2, stripe_subscription_id),
              stripe_customer_id = COALESCE($3, stripe_customer_id),
              billing_interval = $4
        WHERE id = $1
        RETURNING id`,
      [businessId, subscriptionId, customerId, billingInterval]
    );
    if (upd.rowCount === 0) {
      throw new Error(`Negocio ${businessId} no encontrado para upgrade`);
    }

    // Reactivar cupones paused_by_downgrade
    await client.query(
      `UPDATE coupons
          SET status = 'active'
        WHERE business_id = $1 AND status = 'paused_by_downgrade'`,
      [businessId]
    );

    await client.query(
      `INSERT INTO activity_logs (business_id, action, metadata)
       VALUES ($1, 'plan_upgraded', $2::jsonb)`,
      [businessId, JSON.stringify({ stripe_event: event.id })]
    );
  });

  // Invalidar caché tras COMMIT del upgrade: cupones reactivados, plan='premium'.
  invalidateBusinessCaches(businessId);

  // Push/email futuro: queda fuera de esta transacción para no bloquear
  // el ack al webhook. Fase 3 integrará Expo push.
}

async function handleSubscriptionDeleted(event) {
  const sub = event.data?.object || {};
  const customerId = sub.customer;
  const businessIdMeta = Number(sub.metadata?.business_id);

  await withTransaction(async (client) => {
    let businessId = businessIdMeta;
    if (!businessId) {
      const res = await client.query(
        `SELECT id FROM businesses WHERE stripe_customer_id = $1 OR stripe_subscription_id = $2`,
        [customerId, sub.id]
      );
      if (res.rowCount === 0) {
        logger.warn('stripe_downgrade_no_business', { customer_id: customerId });
        return;
      }
      businessId = res.rows[0].id;
    }

    await client.query(
      `UPDATE businesses
          SET plan = 'free', subscription_status = 'canceled'
        WHERE id = $1`,
      [businessId]
    );

    // Pausar cupones excedentes — orden created_at DESC, dejar máx 1 (plan Gratuito v2)
    const countRes = await client.query(
      `SELECT COUNT(*)::int AS n
         FROM coupons
        WHERE business_id = $1 AND status = 'active'`,
      [businessId]
    );
    const activeCount = countRes.rows[0].n;
    if (activeCount > 1) {
      const toPause = activeCount - 1;
      await client.query(
        `UPDATE coupons
            SET status = 'paused_by_downgrade'
          WHERE id IN (
            SELECT id FROM coupons
             WHERE business_id = $1 AND status = 'active'
             ORDER BY created_at DESC
             LIMIT $2
          )`,
        [businessId, toPause]
      );
    }

    await client.query(
      `INSERT INTO activity_logs (business_id, action, metadata)
       VALUES ($1, 'plan_downgraded', $2::jsonb)`,
      [businessId, JSON.stringify({ stripe_event: event.id, paused: Math.max(0, activeCount - 1) })]
    );

    // Capturar businessId resuelto para invalidación post-COMMIT.
    handleSubscriptionDeleted._lastBusinessId = businessId;
  });

  // Invalidar caché tras COMMIT del downgrade: cupones pausados, plan='free'.
  if (handleSubscriptionDeleted._lastBusinessId) {
    invalidateBusinessCaches(handleSubscriptionDeleted._lastBusinessId);
    handleSubscriptionDeleted._lastBusinessId = null;
  }
}

async function handlePaymentFailed(event) {
  const invoice = event.data?.object || {};
  const customerId = invoice.customer;
  await query(
    `UPDATE businesses
        SET subscription_status = 'past_due'
      WHERE stripe_customer_id = $1`,
    [customerId]
  );
  await query(
    `INSERT INTO activity_logs (action, metadata)
     VALUES ('payment_failed', $1::jsonb)`,
    [JSON.stringify({ stripe_event: event.id, customer_id: customerId })]
  );
}

module.exports = {
  createBusinessCheckoutSession,
  handleWebhook,
};
