'use strict';

/**
 * walletService — CART-01 GET /api/wallet/coupons?tab=active|history
 *
 * Contratos:
 *  - tab=active:
 *      coupon_instances ∩ coupons WHERE coupons.status IN ('active', ...)
 *      MUST:
 *        - ci.uses_count < coupons.usage_limit_per_user
 *        - incluir business_status
 *        - ORDER BY coupons.end_date ASC
 *      Observación del test T-282:
 *        - status = 'paused_by_downgrade' NO aparece.
 *      Observación del test T-281:
 *        - business_status = 'suspended' debe aparecer (marcado).
 *
 *  - tab=history:
 *      Cupones expirados o completamente usados (por el consumer).
 *      ORDER BY ci.last_used_at DESC.
 */

const { query } = require('../config/db');
const { AppError } = require('../utils/AppError');

async function getWallet(consumerId, tab) {
  if (tab !== 'active' && tab !== 'history') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Pestaña inválida.');
  }

  if (tab === 'active') {
    // T-282: paused_by_downgrade NO aparece.
    // T-281: business_status='suspended' aparece marcado.
    const r = await query(
      `SELECT ci.id AS instance_id, ci.saved_at, ci.uses_count AS ci_uses, ci.last_used_at,
              c.id AS coupon_id, c.title, c.description, c.discount_type, c.discount_value,
              c.precio_referencia, c.start_date, c.end_date, c.usage_limit_per_user,
              c.total_usage_limit, c.uses_count AS c_uses, c.transferable, c.accumulable,
              c.status AS coupon_status,
              b.id AS business_id, b.business_name, b.category, b.logo_url,
              b.status AS business_status,
              b.lat, b.lng, b.display_address
         FROM coupon_instances ci
         JOIN coupons c ON c.id = ci.coupon_id
         JOIN businesses b ON b.id = c.business_id
        WHERE ci.consumer_id = $1
          AND c.status = 'active'
          AND ci.uses_count < c.usage_limit_per_user
          AND c.end_date >= CURRENT_DATE
        ORDER BY c.end_date ASC
        LIMIT 500`,
      [consumerId]
    );
    return r.rows.map(shape);
  }

  // history: expirados o agotados (por el consumer)
  const r = await query(
    `SELECT ci.id AS instance_id, ci.saved_at, ci.uses_count AS ci_uses, ci.last_used_at,
            c.id AS coupon_id, c.title, c.description, c.discount_type, c.discount_value,
            c.precio_referencia, c.start_date, c.end_date, c.usage_limit_per_user,
            c.total_usage_limit, c.uses_count AS c_uses, c.transferable, c.accumulable,
            c.status AS coupon_status,
            b.id AS business_id, b.business_name, b.category, b.logo_url,
            b.status AS business_status,
            b.lat, b.lng, b.display_address
       FROM coupon_instances ci
       JOIN coupons c ON c.id = ci.coupon_id
       JOIN businesses b ON b.id = c.business_id
      WHERE ci.consumer_id = $1
        AND (
              c.status = 'expired'
           OR c.end_date < CURRENT_DATE
           OR ci.uses_count >= c.usage_limit_per_user
        )
      ORDER BY ci.last_used_at DESC NULLS LAST, c.end_date DESC
      LIMIT 500`,
    [consumerId]
  );
  return r.rows.map(shape);
}

async function getInstanceStatus(consumerId, instanceId) {
  const r = await query(
    `SELECT ci.uses_count,
            ci.last_used_at,
            (
              SELECT r.discount_applied
              FROM redemptions r
              WHERE r.coupon_instance_id = ci.id
              ORDER BY r.redeemed_at DESC
              LIMIT 1
            ) AS last_discount_applied
       FROM coupon_instances ci
      WHERE ci.id = $1 AND ci.consumer_id = $2`,
    [instanceId, consumerId]
  );
  if (r.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Instancia no encontrada.');
  }
  const row = r.rows[0];
  return {
    uses_count: row.uses_count,
    last_used_at: row.last_used_at,
    last_discount_applied: row.last_discount_applied !== null
      ? Number(row.last_discount_applied)
      : null,
  };
}

async function getSavings(consumerId) {
  const r = await query(
    `SELECT
       COALESCE(SUM(discount_applied), 0)::numeric AS total_saved,
       COUNT(*)::int AS redemption_count
     FROM redemptions
     WHERE consumer_id = $1`,
    [consumerId]
  );
  const row = r.rows[0];
  return {
    total_saved: Number(row.total_saved),
    redemption_count: row.redemption_count,
  };
}

function shape(row) {
  return {
    coupon_instance_id: Number(row.instance_id),
    coupon_id: Number(row.coupon_id),
    saved_at: row.saved_at,
    last_used_at: row.last_used_at,
    consumer_uses_count: row.ci_uses,
    title: row.title,
    description: row.description,
    discount_type: row.discount_type,
    discount_value: Number(row.discount_value),
    precio_referencia: row.precio_referencia !== null ? Number(row.precio_referencia) : null,
    start_date: row.start_date,
    end_date: row.end_date,
    usage_limit_per_user: row.usage_limit_per_user,
    total_usage_limit: row.total_usage_limit,
    coupon_uses_count: row.c_uses,
    transferable: row.transferable,
    accumulable: row.accumulable,
    coupon_status: row.coupon_status,
    business: {
      business_id: Number(row.business_id),
      business_name: row.business_name,
      category: row.category,
      logo_url: row.logo_url,
      status: row.business_status,
      business_status: row.business_status,
      lat: row.lat !== null ? Number(row.lat) : null,
      lng: row.lng !== null ? Number(row.lng) : null,
      display_address: row.display_address,
    },
  };
}

module.exports = { getWallet, getInstanceStatus, getSavings };
