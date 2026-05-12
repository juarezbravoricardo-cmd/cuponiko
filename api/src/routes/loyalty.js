'use strict';

/**
 * Rutas /api/loyalty — Fase 3.
 * Orden de middleware: jwtVerify → requireRole → handler.
 */

const express = require('express');
const { asyncHandler } = require('../utils/AppError');
const { jwtVerify, requireRole } = require('../middleware/jwtVerify');
const loyalty = require('../services/loyaltyService');

const router = express.Router();

// LYL-01 — Unirse al programa de lealtad
router.post(
  '/join',
  jwtVerify,
  requireRole('consumer'),
  asyncHandler(async (req, res) => {
    const r = await loyalty.joinLoyalty(req.user.id, req.body || {});
    res.status(200).json({ data: r });
  })
);

// LYL-02 — Asignar sello (negocio)
router.post(
  '/stamp',
  jwtVerify,
  requireRole('business'),
  asyncHandler(async (req, res) => {
    const r = await loyalty.stampLoyalty(req.user.id, req.body || {});
    res.status(200).json({ data: r });
  })
);

// LYL-04 — Canjear recompensa  (va antes de :card_id)
router.post(
  '/redeem-reward',
  jwtVerify,
  requireRole('consumer'),
  asyncHandler(async (req, res) => {
    const r = await loyalty.redeemReward(req.user.id, req.body || {});
    res.status(200).json({ data: r });
  })
);

// LYL-EXT — Mis tarjetas
router.get(
  '/my-cards',
  jwtVerify,
  requireRole('consumer'),
  asyncHandler(async (req, res) => {
    const cards = await loyalty.myLoyaltyCards(req.user.id);
    res.status(200).json({ data: { cards } });
  })
);

// LYL-BIZ-01 — Listar tarjetas del negocio (business)
// IMPORTANTE: rutas estáticas DEBEN ir antes de '/:card_id/refresh-qr'
// para que '/cards' no sea capturado como :card_id.
router.get(
  '/cards',
  jwtVerify,
  requireRole('business'),
  asyncHandler(async (req, res) => {
    const cards = await loyalty.listBusinessCards(req.user.id);
    res.status(200).json({ data: { cards } });
  })
);

// LYL-BIZ-02 — Crear tarjeta de lealtad (business)
router.post(
  '/create',
  jwtVerify,
  requireRole('business'),
  asyncHandler(async (req, res) => {
    const r = await loyalty.createBusinessLoyaltyCard(req.user.id, req.body || {});
    res.status(201).json({ data: r });
  })
);

// LYL-03 — Renovar QR
router.post(
  '/:card_id/refresh-qr',
  jwtVerify,
  requireRole('consumer'),
  asyncHandler(async (req, res) => {
    const r = await loyalty.refreshLoyaltyQr(req.user.id, req.params.card_id);
    res.status(200).json({ data: r });
  })
);

module.exports = router;
