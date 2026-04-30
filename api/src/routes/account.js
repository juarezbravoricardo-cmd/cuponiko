'use strict';

/**
 * Rutas de cuenta (Fase 3.5).
 *   POST /api/account/delete           (consumer | business)
 *   POST /api/account/delete/confirm   (consumer | business)
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

module.exports = router;
