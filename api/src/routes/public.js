'use strict';

/**
 * Rutas públicas (sin JWT) — BIZ-01 y CPN-08.
 * Se montan en dos sub-routers porque comparten prefijo con rutas autenticadas
 * existentes:
 *   GET /api/businesses/:id/public  → publicBusinessesRouter
 *   GET /api/coupons/:id/public     → publicCouponsRouter
 *
 * NO usar jwtVerify aquí. Ver AP de seguridad: tests T-460/T-462 verifican que
 * funcionan sin Authorization header.
 */

const express = require('express');
const { asyncHandler } = require('../utils/AppError');
const pub = require('../services/publicService');

const publicBusinessesRouter = express.Router();
const publicCouponsRouter = express.Router();

publicBusinessesRouter.get(
  '/:id/public',
  asyncHandler(async (req, res) => {
    const data = await pub.getBusinessPublic(req.params.id);
    res.status(200).json({ data });
  })
);

publicCouponsRouter.get(
  '/:id/public',
  asyncHandler(async (req, res) => {
    const data = await pub.getCouponPublic(req.params.id);
    res.status(200).json({ data });
  })
);

module.exports = { publicBusinessesRouter, publicCouponsRouter };
