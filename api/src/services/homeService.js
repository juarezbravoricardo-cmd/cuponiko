'use strict';

/**
 * homeService — HOME-01..04
 *
 * HOME-01 GET /api/businesses/nearby?lat=X&lng=Y&radius=5000&category=...
 * HOME-02 GET /api/geo/ip-location  (fallback)
 * HOME-03 GET /api/ads/active
 * HOME-04 POST /api/ads/:ad_id/click
 *
 * Reglas clave:
 *  - AP-05/06: location GEOGRAPHY es la fuente de verdad; lat/lng del request
 *    son solo entrada.
 *  - AP-11: ST_MakePoint(lng, lat) — lng PRIMERO.
 *  - AP-19: LIMIT obligatorio en queries geo.
 */

const { query } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { isReviewer } = require('../utils/reviewer');
const {
  geoCache,
  couponListCache,
  geoKey,
  getOrSet,
} = require('./cacheService');

const MAX_RADIUS_M = 20000; // 20 km para evitar abusos (AP-19)
const DEFAULT_RADIUS_M = 5000;
const MAX_RESULTS = 50;

// HOME-01
async function nearbyBusinesses({ lat, lng, radius, category, userId }) {
  // --- Reviewer bypass: skip geo filter, return all active businesses ---
  if (isReviewer(userId)) {
    const hasCategory = typeof category === 'string' && category.trim().length > 0;
    const cat = hasCategory ? category.trim() : null;

    const params = [];
    let where = `WHERE b.status = 'active'`;
    if (hasCategory) {
      params.push(cat);
      where += ` AND b.category = $1`;
    }

    const r = await query(
      `SELECT b.id, b.business_name, b.category, b.logo_url, b.display_address, b.plan,
              b.lat, b.lng,
              0 AS dist_m,
              COALESCE((
                SELECT COUNT(*)::int FROM coupons c
                 WHERE c.business_id = b.id AND c.status = 'active'
                   AND c.end_date >= CURRENT_DATE
              ), 0) AS active_coupons_count,
              (SELECT json_build_object(
                  'title', c.title,
                  'discount_type', c.discount_type,
                  'discount_value', c.discount_value
                )
                 FROM coupons c
                 WHERE c.business_id = b.id
                   AND c.status = 'active'
                   AND c.end_date >= CURRENT_DATE
                 ORDER BY c.created_at DESC
                 LIMIT 1) AS top_coupon
         FROM businesses b
         ${where}
         ORDER BY b.created_at DESC
         LIMIT ${MAX_RESULTS}`,
      params
    );
    return r.rows.map((row) => ({
      business_id: Number(row.id),
      business_name: row.business_name,
      category: row.category,
      logo_url: row.logo_url,
      display_address: row.display_address,
      plan: row.plan,
      lat: Number(row.lat),
      lng: Number(row.lng),
      distance_m: 0,
      active_coupons_count: Number(row.active_coupons_count),
      top_coupon: row.top_coupon
        ? {
            title: row.top_coupon.title,
            discount_type: row.top_coupon.discount_type,
            discount_value: Number(row.top_coupon.discount_value),
          }
        : null,
    }));
  }

  // --- Normal user path (unchanged) ---
  const latN = Number(lat);
  const lngN = Number(lng);
  let radiusN = Number(radius || DEFAULT_RADIUS_M);

  if (!Number.isFinite(latN) || latN < -90 || latN > 90) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Latitud inválida.');
  }
  if (!Number.isFinite(lngN) || lngN < -180 || lngN > 180) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Longitud inválida.');
  }
  if (!Number.isFinite(radiusN) || radiusN <= 0) radiusN = DEFAULT_RADIUS_M;
  if (radiusN > MAX_RADIUS_M) radiusN = MAX_RADIUS_M;

  const hasCategory = typeof category === 'string' && category.trim().length > 0;
  const cat = hasCategory ? category.trim() : null;

  // Cache HOME-01: por (lat~3dec, lng~3dec, radius, category). TTL 5 min.
  const key = geoKey(latN, lngN, radiusN, cat);
  return getOrSet(geoCache, key, async () => {
    // AP-11: ST_MakePoint(lng, lat) y ::geography
    // AP-19: LIMIT fijo
    const params = [lngN, latN, radiusN];
    let where = `WHERE b.status = 'active'
                 AND ST_DWithin(b.location, ST_MakePoint($1,$2)::geography, $3)`;
    if (hasCategory) {
      params.push(cat);
      where += ` AND b.category = $4`;
    }

    const r = await query(
      `SELECT b.id, b.business_name, b.category, b.logo_url, b.display_address, b.plan,
              b.lat, b.lng,
              ST_Distance(b.location, ST_MakePoint($1,$2)::geography) AS dist_m,
              COALESCE((
                SELECT COUNT(*)::int FROM coupons c
                 WHERE c.business_id = b.id AND c.status = 'active'
                   AND c.end_date >= CURRENT_DATE
              ), 0) AS active_coupons_count,
              (SELECT json_build_object(
                  'title', c.title,
                  'discount_type', c.discount_type,
                  'discount_value', c.discount_value
                )
                 FROM coupons c
                 WHERE c.business_id = b.id
                   AND c.status = 'active'
                   AND c.end_date >= CURRENT_DATE
                 ORDER BY c.created_at DESC
                 LIMIT 1) AS top_coupon
         FROM businesses b
         ${where}
         ORDER BY dist_m ASC
         LIMIT ${MAX_RESULTS}`,
      params
    );
    return r.rows.map((row) => ({
      business_id: Number(row.id),
      business_name: row.business_name,
      category: row.category,
      logo_url: row.logo_url,
      display_address: row.display_address,
      plan: row.plan,
      lat: Number(row.lat),
      lng: Number(row.lng),
      distance_m: Math.round(Number(row.dist_m)),
      active_coupons_count: Number(row.active_coupons_count),
      top_coupon: row.top_coupon
        ? {
            title: row.top_coupon.title,
            discount_type: row.top_coupon.discount_type,
            discount_value: Number(row.top_coupon.discount_value),
          }
        : null,
    }));
  });
}

// HOME-02 — geo por IP (fallback MVP)
/**
 * Implementación v1.0: sin biblioteca GeoLite2 (se integrará con el binario
 * en Fase 3). Aquí devolvemos CDMX con `source: default_fallback`, excepto
 * cuando la IP cae dentro de rangos privados conocidos, en cuyo caso también
 * devolvemos fallback. Esto cumple T-273 que solo exige que el endpoint
 * regrese 200 con lat/lng/city/source.
 */
function ipLocation(_ip) {
  return {
    lat: 19.4326,
    lng: -99.1332,
    city: 'Ciudad de México',
    source: 'default_fallback',
  };
}

// HOME-03 — Anuncios del carrusel
async function activeAds() {
  // Cache HOME-03: el carrusel es global (no depende del request), TTL 2 min.
  return getOrSet(couponListCache, 'carousel:global', async () => {
    const r = await query(
      `SELECT ap.id AS ad_id, ap.image_url, ap.start_date, ap.end_date,
              ap.redemption_limit, ap.impressions, ap.clicks, ap.status AS ad_status,
              c.id AS coupon_id, c.title, c.description, c.discount_type, c.discount_value,
              c.precio_referencia, c.uses_count, c.total_usage_limit,
              b.id AS business_id, b.business_name, b.category, b.logo_url,
              b.lat, b.lng, b.display_address
         FROM anuncios_pagados ap
         JOIN coupons c ON c.id = ap.coupon_id
         JOIN businesses b ON b.id = ap.business_id
        WHERE ap.status = 'active'
          AND b.status = 'active'
          AND c.status = 'active'
          AND ap.end_date >= CURRENT_DATE
        ORDER BY ap.created_at DESC
        LIMIT 5`
    );
    return r.rows.map((row) => ({
      ad_id: Number(row.ad_id),
      image_url: row.image_url,
      start_date: row.start_date,
      end_date: row.end_date,
      redemption_limit: row.redemption_limit,
      impressions: row.impressions,
      clicks: row.clicks,
      coupon: {
        coupon_id: Number(row.coupon_id),
        title: row.title,
        description: row.description,
        discount_type: row.discount_type,
        discount_value: Number(row.discount_value),
        precio_referencia: row.precio_referencia !== null ? Number(row.precio_referencia) : null,
        uses_count: row.uses_count,
        total_usage_limit: row.total_usage_limit,
      },
      business: {
        business_id: Number(row.business_id),
        business_name: row.business_name,
        category: row.category,
        logo_url: row.logo_url,
        lat: Number(row.lat),
        lng: Number(row.lng),
        display_address: row.display_address,
      },
    }));
  });
}

// HOME-04 — click en anuncio
async function registerAdClick(adId) {
  const id = Number(adId);
  if (!Number.isFinite(id)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'ID de anuncio inválido.');
  }
  const upd = await query(
    `UPDATE anuncios_pagados SET clicks = clicks + 1
      WHERE id = $1 AND status = 'active' RETURNING id, clicks`,
    [id]
  );
  if (upd.rowCount === 0) {
    throw new AppError(404, 'AD_NOT_FOUND', 'Anuncio no encontrado.');
  }
  return { ad_id: Number(upd.rows[0].id), clicks: Number(upd.rows[0].clicks) };
}

module.exports = {
  nearbyBusinesses,
  ipLocation,
  activeAds,
  registerAdClick,
};
