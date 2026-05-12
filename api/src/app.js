'use strict';

/**
 * Construcción de la aplicación Express.
 * Separado de `index.js` para poder importarlo en tests (supertest) sin
 * abrir un puerto TCP.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const env = require('./config/env');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { globalLimiter } = require('./middleware/rateLimiter');

const webhookRoutes = require('./routes/webhooks');
const authRoutes = require('./routes/auth');
const billingRoutes = require('./routes/billing');
const couponsRoutes = require('./routes/coupons');
const walletRoutes = require('./routes/wallet');
const { businessesRouter, geoRouter, adsRouter } = require('./routes/home');
const adsBusinessRoutes = require('./routes/ads');
const loyaltyRoutes = require('./routes/loyalty');
const { adminRouter, alertsRouter } = require('./routes/admin');
const internalRoutes = require('./routes/internal');

// Fase 3.5
const { notificationsRouter, pushRouter } = require('./routes/notifications');
const accountRoutes = require('./routes/account');
const exportsRoutes = require('./routes/exports');
const { publicBusinessesRouter, publicCouponsRouter } = require('./routes/public');

function buildApp() {
  const app = express();
  app.set('trust proxy', true);

  app.use(helmet());

  // CORS: lista blanca configurable via ALLOWED_ORIGINS (separada por comas).
  // En dev, si no se define, se permite localhost. En producción, sin orígenes
  // definidos se rechaza por defecto (fail-closed).
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : env.NODE_ENV === 'production'
      ? []
      : ['http://localhost:19006', 'http://localhost:3000', 'http://localhost:8081'];
  app.use(
    cors({
      origin: (origin, cb) => {
        // Permitir requests sin Origin (curl, healthchecks, mobile nativo).
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          return cb(null, true);
        }
        return cb(new Error(`CORS: origen no permitido (${origin})`));
      },
      credentials: true,
    })
  );

  if (env.NODE_ENV !== 'test') app.use(morgan('tiny'));

  // IMPORTANTE: el webhook debe montarse ANTES del express.json global para
  // preservar el raw body que Stripe usa para verificar firma.
  app.use('/api/webhooks', webhookRoutes);

  // Parsers globales
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Rate limiter global
  app.use(globalLimiter);

  // Healthcheck — Railway usa /health; /healthz se mantiene por compatibilidad.
  const healthHandler = (_req, res) =>
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  app.get('/health', healthHandler);
  app.get('/healthz', healthHandler);

  // Rutas versionadas
  app.use('/api/auth', authRoutes);
  app.use('/api/billing', billingRoutes);

  // Fase 3.5 — rutas públicas (sin JWT). Montadas ANTES de los routers
  // autenticados de /api/businesses y /api/coupons para que :id/public no
  // sea capturado por jwtVerify.
  app.use('/api/businesses', publicBusinessesRouter);
  app.use('/api/coupons', publicCouponsRouter);

  // Fase 2
  app.use('/api/coupons', couponsRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/businesses', businessesRouter);
  app.use('/api/geo', geoRouter);
  // IMPORTANTE: el router business va PRIMERO para que `/create` y `/my-ads`
  // (rutas estáticas) no sean capturados por `/:ad_id/click` del consumer.
  app.use('/api/ads', adsBusinessRoutes);
  app.use('/api/ads', adsRouter);

  // Fase 3
  app.use('/api/loyalty', loyaltyRoutes);
  app.use('/api/admin', adminRouter);
  app.use('/api/alerts', alertsRouter);
  app.use('/internal', internalRoutes);
  app.use('/api/internal', internalRoutes); // alias por compatibilidad

  // Fase 3.5 — rutas autenticadas
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/push', pushRouter);
  app.use('/api/account', accountRoutes);
  app.use('/api/exports', exportsRoutes);

  // 404 + handler global
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { buildApp };
