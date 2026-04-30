'use strict';

/**
 * Rutas internas /api/internal/* — disparadas por pg_cron en Supabase.
 * Protegidas por header x-internal-secret (middleware internalOnly).
 */

const express = require('express');
const { asyncHandler } = require('../utils/AppError');
const internalOnly = require('../middleware/internalOnly');
const jobs = require('../services/jobsService');

const router = express.Router();
router.use(internalOnly);

router.post(
  '/jobs/coupon-expiry-notifier',
  asyncHandler(async (_req, res) => {
    const r = await jobs.couponExpiryNotifier();
    res.status(200).json({ data: r });
  })
);

router.post(
  '/jobs/loyalty-inactivity-tagger',
  asyncHandler(async (_req, res) => {
    const r = await jobs.loyaltyInactivityTagger();
    res.status(200).json({ data: r });
  })
);

router.post(
  '/jobs/cleanup-expired-pdfs',
  asyncHandler(async (_req, res) => {
    const r = await jobs.cleanupExpiredPdfs();
    res.status(200).json({ data: r });
  })
);

module.exports = router;
