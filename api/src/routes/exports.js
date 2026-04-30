'use strict';

/**
 * Rutas de exportación PDF (Fase 3.5).
 *   POST /api/exports/pdf    (business)
 *   GET  /api/exports/:id    (business)
 */

const express = require('express');
const { asyncHandler } = require('../utils/AppError');
const { jwtVerify, requireRole } = require('../middleware/jwtVerify');
const exportsSvc = require('../services/exportsService');

const router = express.Router();

router.post(
  '/pdf',
  jwtVerify,
  requireRole('business'),
  asyncHandler(async (req, res) => {
    const data = await exportsSvc.requestExport(req.user.id, req.body || {});
    res.status(202).json({ data });
  })
);

router.get(
  '/:id',
  jwtVerify,
  requireRole('business'),
  asyncHandler(async (req, res) => {
    const data = await exportsSvc.getExportStatus(req.user.id, req.params.id);
    res.status(200).json({ data });
  })
);

module.exports = router;
