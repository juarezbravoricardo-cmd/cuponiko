'use strict';

/**
 * Rutas de notificaciones (Fase 3.5).
 *   GET   /api/notifications                 (consumer | business)
 *   PATCH /api/notifications/:id/read        (consumer | business)
 *   POST  /api/notifications/send            (business, plan premium)
 *
 * El registro de push token vive en /api/push/token (router pushRouter).
 */

const express = require('express');
const { asyncHandler } = require('../utils/AppError');
const { jwtVerify, requireRole } = require('../middleware/jwtVerify');
const notif = require('../services/notificationsService');

const notificationsRouter = express.Router();
const pushRouter = express.Router();

// NOTIFY-01
notificationsRouter.get(
  '/',
  jwtVerify,
  requireRole('consumer', 'business'),
  asyncHandler(async (req, res) => {
    const data = await notif.listNotifications(req.user.id, {
      page: req.query.page,
      limit: req.query.limit,
      unreadOnly: req.query.unread_only,
    });
    res.status(200).json({ data });
  })
);

// NOTIFY-04 — debe ir ANTES de la ruta dinámica con :id para evitar colisión
notificationsRouter.post(
  '/send',
  jwtVerify,
  requireRole('business'),
  asyncHandler(async (req, res) => {
    const data = await notif.sendToSegment(req.user.id, req.body || {});
    res.status(202).json({ data });
  })
);

// NOTIFY-02
notificationsRouter.patch(
  '/:id/read',
  jwtVerify,
  requireRole('consumer', 'business'),
  asyncHandler(async (req, res) => {
    const data = await notif.markRead(req.params.id, req.user.id);
    res.status(200).json({ data });
  })
);

// NOTIFY-03 — pushRouter monta bajo /api/push
pushRouter.post(
  '/token',
  jwtVerify,
  requireRole('consumer', 'business'),
  asyncHandler(async (req, res) => {
    const data = await notif.registerPushToken(req.user.id, req.body || {});
    res.status(200).json({ data });
  })
);

module.exports = { notificationsRouter, pushRouter };
