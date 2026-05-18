'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/AppError');
const { jwtVerify, requireRole } = require('../middleware/jwtVerify');
const wallet = require('../services/walletService');

const router = express.Router();

// CART-01
router.get(
  '/coupons',
  jwtVerify,
  requireRole('consumer'),
  asyncHandler(async (req, res) => {
    const tab = req.query.tab || 'active';
    const list = await wallet.getWallet(req.user.id, tab);
    res.status(200).json({ data: { tab, coupons: list } });
  })
);

// WALLET-02: status de instancia para polling del QR screen
router.get(
  '/instance/:id/status',
  jwtVerify,
  requireRole('consumer'),
  asyncHandler(async (req, res) => {
    const instanceId = Number(req.params.id);
    const consumerId = req.user.id;
    const data = await wallet.getInstanceStatus(consumerId, instanceId);
    res.status(200).json({ data });
  })
);

module.exports = router;
