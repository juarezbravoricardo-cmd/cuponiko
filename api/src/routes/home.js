'use strict';

/**
 * Rutas para HOME-01..04.
 * Se montan bajo tres prefijos distintos para mantener las URLs exactas del
 * contrato:
 *   GET  /api/businesses/nearby   (consumer JWT)
 *   GET  /api/geo/ip-location     (público)
 *   GET  /api/ads/active          (consumer JWT)
 *   POST /api/ads/:ad_id/click    (consumer JWT)
 */

const express = require('express');
const { asyncHandler } = require('../utils/AppError');
const { jwtVerify, requireRole } = require('../middleware/jwtVerify');
const home = require('../services/homeService');

const businessesRouter = express.Router();
const geoRouter = express.Router();
const adsRouter = express.Router();

// HOME-01
businessesRouter.get(
  '/nearby',
  jwtVerify,
  requireRole('consumer'),
  asyncHandler(async (req, res) => {
    const { lat, lng, radius, category } = req.query;
    const list = await home.nearbyBusinesses({ lat, lng, radius, category, userId: req.user.id });
    res.status(200).json({ data: { businesses: list } });
  })
);

// HOME-02 — PUBLIC (usa IP del request)
geoRouter.get(
  '/ip-location',
  asyncHandler(async (req, res) => {
    const ipHeader = req.headers['x-forwarded-for'];
    const ip = ipHeader ? String(ipHeader).split(',')[0].trim() : req.ip || null;
    const data = home.ipLocation(ip);
    res.status(200).json({ data });
  })
);

// HOME-03
adsRouter.get(
  '/active',
  jwtVerify,
  requireRole('consumer'),
  asyncHandler(async (_req, res) => {
    const ads = await home.activeAds();
    res.status(200).json({ data: { ads } });
  })
);

// HOME-04
adsRouter.post(
  '/:ad_id/click',
  jwtVerify,
  requireRole('consumer'),
  asyncHandler(async (req, res) => {
    const r = await home.registerAdClick(req.params.ad_id);
    res.status(200).json({ data: r });
  })
);

module.exports = { businessesRouter, geoRouter, adsRouter };
