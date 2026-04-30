'use strict';

const express = require('express');
const multer = require('multer');
const { asyncHandler } = require('../utils/AppError');
const { businessRegisterLimiter } = require('../middleware/rateLimiter');
const authService = require('../services/authService');

const router = express.Router();

// Configuración de multer para logo_file opcional (max 2MB, PNG/JPG).
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/png', 'image/jpeg'].includes(file.mimetype)) return cb(null, true);
    return cb(new Error('Logo debe ser PNG o JPG.'));
  },
});

// AUTH-01
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const result = await authService.registerConsumer(req.body || {});
    res.status(201).json({ data: result });
  })
);

// AUTH-02
router.post(
  '/register/google',
  asyncHandler(async (req, res) => {
    const result = await authService.registerWithGoogle(req.body || {});
    res.status(201).json({ data: result });
  })
);

// AUTH-03
router.post(
  '/register/business',
  businessRegisterLimiter,
  logoUpload.single('logo_file'),
  asyncHandler(async (req, res) => {
    // Si llegó multipart/form-data, req.body son strings; logo_file está en req.file
    const payload = { ...req.body };
    // logo opcional: por ahora no subimos a Supabase Storage en Fase 1; se guarda null.
    // La integración real de upload a bucket business-logos se hará en Fase 2 cuando
    // el dashboard del negocio lo requiera.
    payload.logo_url = null;
    const result = await authService.registerBusiness(payload);
    res.status(201).json({ data: result });
  })
);

// AUTH-04
router.post(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const result = await authService.verifyEmail(req.body || {});
    res.status(200).json({ data: result });
  })
);

// AUTH-05
router.post(
  '/verify-phone',
  asyncHandler(async (req, res) => {
    const result = await authService.verifyPhone(req.body || {});
    res.status(200).json({ data: result });
  })
);

// AUTH-06
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const result = await authService.login(req.body || {});
    res.status(200).json({ data: result });
  })
);

// AUTH-07
router.post(
  '/login/google',
  asyncHandler(async (req, res) => {
    const result = await authService.loginWithGoogle(req.body || {});
    res.status(200).json({ data: result });
  })
);

// AUTH-08
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const result = await authService.refreshSession(req.body || {});
    res.status(200).json({ data: result });
  })
);

// AUTH-09
router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const result = await authService.forgotPassword(req.body || {});
    res.status(200).json({ data: result });
  })
);

// AUTH-10
router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const result = await authService.resetPassword(req.body || {});
    res.status(200).json({ data: result });
  })
);

module.exports = router;
