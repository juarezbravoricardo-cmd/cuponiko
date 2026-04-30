'use strict';

/**
 * Rutas /api/admin — Fase 3.
 * Acceso: rol 'admin' salvo el reporte de fraude (rol 'business' bajo /api/alerts).
 */

const express = require('express');
const { asyncHandler } = require('../utils/AppError');
const { jwtVerify, requireRole } = require('../middleware/jwtVerify');
const admin = require('../services/adminService');

const adminRouter = express.Router();
const alertsRouter = express.Router();

// ADMIN-01
adminRouter.get(
  '/businesses',
  jwtVerify,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const r = await admin.listBusinesses({
      status: req.query.status,
      search: req.query.search,
      page: req.query.page,
    });
    res.status(200).json({ data: r });
  })
);

// ADMIN-02
adminRouter.patch(
  '/businesses/:id/suspend',
  jwtVerify,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const r = await admin.suspendBusiness(req.user.id, req.params.id);
    res.status(200).json({ data: r });
  })
);

// ADMIN-03
adminRouter.patch(
  '/businesses/:id/activate',
  jwtVerify,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const r = await admin.activateBusiness(req.user.id, req.params.id);
    res.status(200).json({ data: r });
  })
);

// ADMIN-04
adminRouter.get(
  '/alerts',
  jwtVerify,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const r = await admin.listAlerts({
      resolved: req.query.resolved,
      type: req.query.type,
      page: req.query.page,
    });
    res.status(200).json({ data: r });
  })
);

// ADMIN-05
adminRouter.patch(
  '/alerts/:id/resolve',
  jwtVerify,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const r = await admin.resolveAlert(req.user.id, req.params.id, req.body || {});
    res.status(200).json({ data: r });
  })
);

// ADMIN-06
adminRouter.patch(
  '/users/:id/block',
  jwtVerify,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const r = await admin.blockUser(req.user.id, req.params.id);
    res.status(200).json({ data: r });
  })
);

// ADMIN-08
adminRouter.get(
  '/metrics',
  jwtVerify,
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const r = await admin.globalMetrics();
    res.status(200).json({ data: r });
  })
);

// ADMIN-07 — Reporte de fraude desde negocios (montado en /api/alerts)
alertsRouter.post(
  '/report',
  jwtVerify,
  requireRole('business'),
  asyncHandler(async (req, res) => {
    const r = await admin.reportAlert(req.user.id, req.body || {});
    res.status(201).json({ data: r });
  })
);

module.exports = { adminRouter, alertsRouter };
