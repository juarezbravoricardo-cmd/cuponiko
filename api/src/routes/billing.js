'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/AppError');
const { jwtVerify, requireRole } = require('../middleware/jwtVerify');
const billingService = require('../services/billingService');

const router = express.Router();

// BILL-01: Crear sesión de checkout
router.post(
  '/create-checkout-session',
  jwtVerify,
  requireRole('business'),
  asyncHandler(async (req, res) => {
    const result = await billingService.createBusinessCheckoutSession({
      userId: req.user.id,
      billingInterval: req.body?.billing_interval,
    });
    res.status(200).json({ data: result });
  })
);

module.exports = router;
