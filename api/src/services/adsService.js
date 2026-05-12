'use strict';

/**
 * adsService — Anuncios exclusive_offer (Fase 3).
 *
 * Endpoints cubiertos:
 *  - AD-01 POST /api/ads/create   (business, plan premium)
 *
 * Reglas no negociables:
 *  - AP-03: la creación es UNA transacción atómica
 *           coupon → anuncio → coupon.ad_id. Si cualquiera falla, ROLLBACK
 *           total (T-311).
 *  - AP-08: mensajes literales del contrato.
 *  - AP-13: el cupón nace en estado 'active' (max una transición posterior).
 */

const { query, withTransaction } = require('../config/db');
const { AppError } = require('../utils/AppError');
const {
  getBusinessByUserId,
  assertBusinessActive,
} = require('../middleware/planChecker');

const COST_TYPES = new Set(['cpc', 'flat']);
const DISCOUNT_TYPES = new Set(['percent', 'fixed', '2x1', 'free']);
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

/**
 * Hook opcional para tests: si se setea `_failAfterCouponInsertOnce = true`,
 * la próxima ejecución lanzará un error sintético DESPUÉS del INSERT del
 * cupón, dentro de la misma transacción, para verificar el ROLLBACK (T-311).
 */
let _failAfterCouponInsertOnce = false;
function _armFailAfterCouponInsert() {
  _failAfterCouponInsertOnce = true;
}

async function createAd(userId, body) {
  const b = body || {};

  // V0 — discount_type válido
  if (!DISCOUNT_TYPES.has(b.discount_type)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Tipo de descuento inválido.');
  }

  // V0bis — image_url + title
  if (!b.image_url || typeof b.image_url !== 'string' || !b.image_url.trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', 'La imagen del anuncio es obligatoria.');
  }
  const title = (b.title || '').toString().trim();
  if (!title || title.length > 255) {
    throw new AppError(400, 'VALIDATION_ERROR', 'El título del anuncio es obligatorio.');
  }

  // V0 — discount_value > 0
  const discountValue = Number(b.discount_value);
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'El valor del descuento debe ser mayor a 0.');
  }

  // V4 — 2x1/free → precio_referencia presente
  let precioReferencia = null;
  if (b.precio_referencia !== undefined && b.precio_referencia !== null) {
    precioReferencia = Number(b.precio_referencia);
  }
  if (b.discount_type === '2x1' || b.discount_type === 'free') {
    if (!(precioReferencia > 0)) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'El precio de referencia es obligatorio para este tipo de descuento.'
      );
    }
  } else if (precioReferencia !== null && !(precioReferencia > 0)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Precio de referencia inválido.');
  }

  // V2 — redemption_limit > 0
  const redemptionLimit = Number(b.redemption_limit);
  if (!Number.isFinite(redemptionLimit) || redemptionLimit <= 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Define un límite de canjes para el anuncio.');
  }

  // V3 — fechas
  const start = parseDateYmd(b.start_date, 'Fecha de inicio');
  const end = parseDateYmd(b.end_date, 'Fecha de fin');
  const today = parseDateYmd(todayUtcYmd(), 'Fecha de inicio');
  if (start < today || end <= start) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Fechas inválidas.');
  }

  // V costo
  if (!COST_TYPES.has(b.cost_type)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Tipo de costo inválido.');
  }
  const costValue = Number(b.cost_value);
  if (!Number.isFinite(costValue) || costValue <= 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'El costo del anuncio debe ser mayor a 0.');
  }

  return withTransaction(async (client) => {
    // V1 — businesses.status = 'active'
    const biz = await getBusinessByUserId(client, userId);
    assertBusinessActive(biz);

    // PASO 1 — INSERT cupón (is_ad_exclusive=TRUE, accumulable=FALSE, transferable=FALSE)
    const couponIns = await client.query(
      `INSERT INTO coupons (
         business_id, title, description, discount_type, discount_value, precio_referencia,
         start_date, end_date, usage_limit_per_user, total_usage_limit,
         transferable, accumulable, max_accumulated_discount, max_coupons_per_tx,
         single_use, is_ad_exclusive, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, 1, $9, FALSE, FALSE, 70, 2, TRUE, TRUE, 'active')
       RETURNING id`,
      [
        biz.id,
        title,
        b.description || null,
        b.discount_type,
        discountValue,
        precioReferencia,
        b.start_date,
        b.end_date,
        redemptionLimit,
      ]
    );
    const couponId = Number(couponIns.rows[0].id);

    // Hook de tests para verificar ROLLBACK total (T-311).
    if (_failAfterCouponInsertOnce) {
      _failAfterCouponInsertOnce = false;
      throw new AppError(500, 'AD_TX_FAIL_TEST', 'Fallo simulado en transacción.');
    }

    // PASO 2 — INSERT anuncios_pagados
    const adIns = await client.query(
      `INSERT INTO anuncios_pagados (
         business_id, coupon_id, image_url, start_date, end_date,
         cost_type, cost_value, redemption_limit, impressions, clicks, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, 'active')
       RETURNING id`,
      [
        biz.id,
        couponId,
        b.image_url,
        b.start_date,
        b.end_date,
        b.cost_type,
        costValue,
        redemptionLimit,
      ]
    );
    const adId = Number(adIns.rows[0].id);

    // PASO 3 — UPDATE coupons.ad_id = ad_id
    await client.query(
      `UPDATE coupons SET ad_id = $1 WHERE id = $2`,
      [adId, couponId]
    );

    return {
      ad_id: adId,
      coupon_id: couponId,
      message: 'Anuncio publicado con éxito.',
    };
  });
}

// ────────────────────────────────────────────────────────────
// AD-BIZ-01 — Listar anuncios del negocio autenticado
// ────────────────────────────────────────────────────────────
async function listBusinessAds(userId) {
  const bizRes = await query(
    'SELECT id FROM businesses WHERE user_id = $1',
    [userId]
  );
  if (bizRes.rowCount === 0) {
    throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Negocio no encontrado.');
  }
  const businessId = Number(bizRes.rows[0].id);

  // JOIN con coupons para título + uses_count (proxy de redenciones).
  // No usamos coupon_instances.status='redeemed' porque es ad_exclusive y
  // single_use — uses_count del cupón refleja exactamente las redenciones.
  const r = await query(
    `SELECT a.id          AS ad_id,
            a.coupon_id,
            a.image_url,
            a.start_date,
            a.end_date,
            a.cost_type,
            a.cost_value,
            a.redemption_limit,
            a.impressions,
            a.clicks,
            a.status,
            a.created_at,
            c.title,
            c.discount_type,
            c.discount_value,
            c.uses_count                          AS redemptions
       FROM anuncios_pagados a
  LEFT JOIN coupons c ON c.id = a.coupon_id
      WHERE a.business_id = $1
   ORDER BY a.created_at DESC
      LIMIT 200`,
    [businessId]
  );

  return r.rows.map((row) => ({
    ad_id: Number(row.ad_id),
    coupon_id: row.coupon_id !== null ? Number(row.coupon_id) : null,
    title: row.title || '',
    image_url: row.image_url,
    status: row.status,
    start_date: row.start_date,
    end_date: row.end_date,
    cost_type: row.cost_type,
    cost_value: Number(row.cost_value),
    redemption_limit: row.redemption_limit,
    impressions: row.impressions,
    clicks: row.clicks,
    redemptions: row.redemptions || 0,
    discount_type: row.discount_type,
    discount_value: row.discount_value !== null ? Number(row.discount_value) : null,
    created_at: row.created_at,
  }));
}

module.exports = {
  createAd,
  listBusinessAds,
  // hook test-only
  _armFailAfterCouponInsert,
};
