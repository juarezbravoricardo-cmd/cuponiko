'use strict';

/**
 * Rutas de cuenta (Fase 3.5 + post-Stripe LIVE).
 *   POST /api/account/delete           (consumer | business)
 *   POST /api/account/delete/confirm   (consumer | business)
 *   GET  /api/account/business/me      (business)
 */

const express = require('express');
const { asyncHandler } = require('../utils/AppError');
const { jwtVerify, requireRole } = require('../middleware/jwtVerify');
const account = require('../services/accountService');
const { query } = require('../config/db');

const router = express.Router();

router.post(
  '/delete',
  jwtVerify,
  requireRole('consumer', 'business'),
  asyncHandler(async (req, res) => {
    const data = await account.requestAccountDeletion(req.user.id, req.body || {});
    res.status(200).json({ data });
  })
);

router.post(
  '/delete/confirm',
  jwtVerify,
  requireRole('consumer', 'business'),
  asyncHandler(async (req, res) => {
    const data = await account.confirmAccountDeletion(req.user.id, req.body || {});
    res.status(200).json({ data });
  })
);

/**
 * GET /api/account/business/me
 * Retorna el estado actual del negocio del usuario autenticado.
 *
 * Existe porque el JWT solo lleva {sub, role, email}; el frontend necesita
 * leer plan/billing_interval directo de DB para reflejar cambios post-pago
 * (sin requerir logout/login). Ver fix post-Stripe LIVE.
 */
router.get(
  '/business/me',
  jwtVerify,
  requireRole('business'),
  asyncHandler(async (req, res) => {
    const data = await account.getMyBusiness(req.user.id);
    res.status(200).json({ data });
  })
);

// DASH-01: métricas rápidas del dashboard negocio
router.get(
  '/dashboard-stats',
  jwtVerify,
  requireRole('business'),
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const r = await query(`
      SELECT
        (SELECT COUNT(*) FROM coupons c
         JOIN businesses b ON b.id = c.business_id
         WHERE b.user_id = $1 AND c.status = 'active'
         AND c.is_ad_exclusive = false
        )::int AS active_coupons,
        (SELECT COUNT(*) FROM redemptions r
         JOIN businesses b ON b.id = r.business_id
         WHERE b.user_id = $1 AND r.redeemed_at::date = CURRENT_DATE
        )::int AS redemptions_today,
        (SELECT COUNT(DISTINCT cl.consumer_id) FROM consumer_loyalty cl
         JOIN loyalty_cards lc ON lc.id = cl.loyalty_card_id
         JOIN businesses b ON b.id = lc.business_id
         WHERE b.user_id = $1
        )::int AS loyalty_customers
    `, [userId]);
    res.status(200).json({ data: r.rows[0] });
  })
);

module.exports = router;
