'use strict';

/**
 * Rutas /api/coupons — Fase 2.
 * Orden de middleware SIEMPRE: jwtVerify → requireRole → limiters → handler
 * (AP-20: el orden es explícito).
 */

const express = require('express');
const { asyncHandler } = require('../utils/AppError');
const { jwtVerify, requireRole } = require('../middleware/jwtVerify');
const { qrGenerationLimiter } = require('../middleware/qrLimiter');
const { scannerCooldownGuard } = require('../middleware/scannerLimiter');
const coupons = require('../services/couponsService');

const router = express.Router();

// CPN-01
router.post(
  '/',
  jwtVerify,
  requireRole('business'),
  asyncHandler(async (req, res) => {
    const result = await coupons.createCoupon(req.user.id, req.body || {});
    res.status(201).json({ data: result });
  })
);

// CPN-02
router.get(
  '/my-coupons',
  jwtVerify,
  requireRole('business'),
  asyncHandler(async (req, res) => {
    const list = await coupons.listMyCoupons(req.user.id, req.query.status);
    res.status(200).json({ data: { coupons: list } });
  })
);

// CPN-03 — Pausar
router.patch(
  '/:coupon_id/pause',
  jwtVerify,
  requireRole('business'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.coupon_id);
    const r = await coupons.pauseCoupon(req.user.id, id);
    res.status(200).json({ data: r });
  })
);

// CPN-04 — Reactivar
router.patch(
  '/:coupon_id/activate',
  jwtVerify,
  requireRole('business'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.coupon_id);
    const r = await coupons.activateCoupon(req.user.id, id);
    res.status(200).json({ data: r });
  })
);

// CPN-07 — Redimir (ENDPOINT CRÍTICO). Va ANTES de las rutas con :coupon_id
// para evitar que `/redeem` matchee como parámetro.
router.post(
  '/redeem',
  jwtVerify,
  requireRole('business'),
  scannerCooldownGuard,
  asyncHandler(async (req, res) => {
    const r = await coupons.redeemCoupon({
      userId: req.user.id,
      businessId: req.businessIdForScanner,
      body: req.body || {},
    });
    res.status(200).json({ data: r });
  })
);

// CPN-05 — Guardar cupón
router.post(
  '/:coupon_id/save',
  jwtVerify,
  requireRole('consumer'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.coupon_id);
    const r = await coupons.saveCouponToWallet(req.user.id, id);
    res.status(200).json({ data: r });
  })
);

// CPN-06 — Generar QR
router.post(
  '/:instance_id/generate-qr',
  jwtVerify,
  requireRole('consumer'),
  qrGenerationLimiter,
  asyncHandler(async (req, res) => {
    const instanceId = Number(req.params.instance_id);
    const r = await coupons.generateQr(req.user.id, instanceId);
    res.status(200).json({ data: r });
  })
);

module.exports = router;
