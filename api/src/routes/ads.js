'use strict';

/**
 * Rutas /api/ads — vertiente BUSINESS (Fase 3).
 *
 * Este router complementa el `adsRouter` de `routes/home.js`, que cubre
 * los endpoints CONSUMER (`GET /active`, `POST /:ad_id/click`).
 *
 * Aquí se exponen:
 *  - AD-01     POST /api/ads/create   (business, plan premium asumido en service)
 *  - AD-BIZ-01 GET  /api/ads/my-ads   (business)
 *
 * Las rutas estáticas se montan ANTES de cualquier ruta paramétrica del
 * router consumer en `app.js` para evitar que `/create` o `/my-ads` sean
 * capturados por `/:ad_id/click`. Como Express resuelve por orden de
 * registro, este router debe montarse en `app.use('/api/ads', adsBusinessRouter)`
 * ANTES del `adsRouter` consumer.
 */

const express = require('express');
const { asyncHandler } = require('../utils/AppError');
const { jwtVerify, requireRole } = require('../middleware/jwtVerify');
const ads = require('../services/adsService');

const router = express.Router();

// AD-01 — Crear anuncio (business)
router.post(
  '/create',
  jwtVerify,
  requireRole('business'),
  asyncHandler(async (req, res) => {
    const r = await ads.createAd(req.user.id, req.body || {});
    res.status(201).json({ data: r });
  })
);

// AD-BIZ-01 — Mis anuncios (business)
router.get(
  '/my-ads',
  jwtVerify,
  requireRole('business'),
  asyncHandler(async (req, res) => {
    const list = await ads.listBusinessAds(req.user.id);
    res.status(200).json({ data: { ads: list } });
  })
);

module.exports = router;
