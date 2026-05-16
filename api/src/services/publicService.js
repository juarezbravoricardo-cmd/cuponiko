'use strict';

/**
 * publicService — implementa BIZ-01 y CPN-08 de cuponiko_contratos_api_v2.md
 *
 * Analogía: la "vista al escaparate" de un local. Cualquier transeúnte puede
 * mirar lo que se ofrece desde la calle (público), pero NO puede entrar a la
 * trastienda. Aquí exponemos solo el subset que verá un consumer no logueado
 * que abre un deeplink.
 *
 * Reglas críticas honradas:
 *  - Negocio suspendido o inactivo → 404 (no revelar estado).
 *  - `uses_count` NUNCA al frontend público; se calcula `remaining_uses`.
 *  - IDs internos (stripe_*, user_id) excluidos.
 */

const { query } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { businessProfileCache, getOrSet } = require('./cacheService');

// ────────────────────────────────────────────────────────────
// BIZ-01: GET /api/businesses/:id/public
// ────────────────────────────────────────────────────────────
async function getBusinessPublic(rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(404, 'NOT_FOUND', 'Negocio no encontrado.');
  }

  // Cache BIZ-01: perfil público por id. TTL 10 min, invalidado en mutaciones
  // del negocio (ver invalidateBusinessCaches). Errores NO se cachean.
  return getOrSet(businessProfileCache, `biz:${id}`, async () => {
    const r = await query(
      `SELECT b.id,
              b.business_name,
              b.category,
              b.display_address,
              b.lat,
              b.lng,
              b.logo_url,
              b.created_at,
              (
                SELECT COUNT(*)::int FROM coupons c
                  WHERE c.business_id = b.id
                    AND c.status = 'active'
                    AND c.end_date >= CURRENT_DATE
              ) AS active_coupons_count,
              EXISTS (
                SELECT 1 FROM loyalty_cards lc
                  WHERE lc.business_id = b.id AND lc.is_active = true
              ) AS has_loyalty_program
         FROM businesses b
        WHERE b.id = $1
          AND b.status = 'active'`,
      [id]
    );
    if (r.rowCount === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Negocio no encontrado.');
    }
    const b = r.rows[0];
    return {
      id: Number(b.id),
      business_name: b.business_name,
      category: b.category,
      display_address: b.display_address,
      lat: b.lat !== null ? Number(b.lat) : null,
      lng: b.lng !== null ? Number(b.lng) : null,
      logo_url: b.logo_url,
      active_coupons_count: b.active_coupons_count,
      has_loyalty_program: b.has_loyalty_program,
      created_at: b.created_at,
    };
  });
}

// ────────────────────────────────────────────────────────────
// CPN-08: GET /api/coupons/:id/public
// ────────────────────────────────────────────────────────────
async function getCouponPublic(rawId) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(404, 'NOT_FOUND', 'Cupón no encontrado.');
  }

  // 1. Existencia + status active (validaciones 1 y 2 → mismo 404)
  const r = await query(
    `SELECT c.id,
            c.title,
            c.description,
            c.discount_type,
            c.discount_value,
            c.precio_referencia,
            c.start_date,
            c.end_date,
            c.total_usage_limit,
            c.uses_count,
            c.is_ad_exclusive,
            c.status,
            b.id AS business_id,
            b.business_name,
            b.category,
            b.logo_url,
            b.status AS business_status
       FROM coupons c
       JOIN businesses b ON b.id = c.business_id
      WHERE c.id = $1`,
    [id]
  );
  if (r.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Cupón no encontrado.');
  }
  const c = r.rows[0];
  if (c.status !== 'active' || c.business_status !== 'active') {
    throw new AppError(404, 'NOT_FOUND', 'Cupón no encontrado.');
  }
  // 3. end_date >= hoy
  const todayUtc = new Date(); // CURRENT_DATE en server tz; comparamos por DATE
  // Hacemos la comparación en SQL para evitar zona horaria del nodo:
  const exp = await query(
    `SELECT (end_date >= CURRENT_DATE)::boolean AS valid FROM coupons WHERE id = $1`,
    [id]
  );
  if (!exp.rows[0].valid) {
    throw new AppError(410, 'COUPON_EXPIRED', 'Este cupón ya venció.');
  }

  const remaining = Math.max(
    0,
    Number(c.total_usage_limit || 0) - Number(c.uses_count || 0)
  );

  return {
    id: Number(c.id),
    title: c.title,
    description: c.description,
    discount_type: c.discount_type,
    discount_value: c.discount_value !== null ? Number(c.discount_value) : null,
    precio_referencia: c.precio_referencia !== null ? Number(c.precio_referencia) : null,
    start_date: typeof c.start_date === 'string' ? c.start_date : c.start_date.toISOString().slice(0, 10),
    end_date: typeof c.end_date === 'string' ? c.end_date : c.end_date.toISOString().slice(0, 10),
    remaining_uses: remaining,
    is_ad_exclusive: c.is_ad_exclusive === true,
    business: {
      id: Number(c.business_id),
      business_name: c.business_name,
      category: c.category,
      logo_url: c.logo_url,
    },
  };
}

module.exports = {
  getBusinessPublic,
  getCouponPublic,
};
