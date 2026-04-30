'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/AppError');
const billingService = require('../services/billingService');

const router = express.Router();

/**
 * BILL-02 — POST /api/webhooks/stripe
 *
 * IMPORTANTE: este router se monta ANTES de express.json() y usa
 * express.raw({ type: 'application/json' }) para preservar el cuerpo sin parsear,
 * requerido por stripe.webhooks.constructEvent para validar la firma.
 */
router.post(
  '/stripe',
  express.raw({ type: '*/*' }),
  asyncHandler(async (req, res) => {
    const signature = req.headers['stripe-signature'];
    const result = await billingService.handleWebhook({
      rawBody: req.body, // Buffer
      signature,
    });
    res.status(200).json({ received: true, ...result });
  })
);

module.exports = router;
