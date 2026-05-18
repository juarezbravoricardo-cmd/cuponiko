'use strict';

const express = require('express');
const multer = require('multer');
const { asyncHandler, AppError } = require('../utils/AppError');
const { jwtVerify, requireRole } = require('../middleware/jwtVerify');
const env = require('../config/env');

const router = express.Router();

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (_req, file, cb) => {
    if (['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) return cb(null, true);
    return cb(new Error('Solo se permiten imágenes PNG, JPG o WebP.'));
  },
});

// UPLOAD-01: subir imagen de anuncio
router.post(
  '/ad-image',
  jwtVerify,
  requireRole('business'),
  imageUpload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError(400, 'MISSING_IMAGE', 'Imagen obligatoria.');

    const ext = req.file.mimetype.split('/')[1] === 'jpeg' ? 'jpg' : req.file.mimetype.split('/')[1];
    const filename = `${req.user.id}_${Date.now()}.${ext}`;

    // Upload a Supabase Storage via REST API
    const uploadUrl = `${env.SUPABASE_URL}/storage/v1/object/ad-images/${filename}`;
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': req.file.mimetype,
        'x-upsert': 'true',
      },
      body: req.file.buffer,
    });

    if (!uploadRes.ok) {
      const body = await uploadRes.text();
      throw new AppError(500, 'UPLOAD_FAILED', `Error subiendo imagen: ${body}`);
    }

    const publicUrl = `${env.SUPABASE_URL}/storage/v1/object/public/ad-images/${filename}`;

    res.status(200).json({
      data: { image_url: publicUrl, filename },
    });
  })
);

module.exports = router;
