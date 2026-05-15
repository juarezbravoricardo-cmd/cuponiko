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

module.exports = router;
