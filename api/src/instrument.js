'use strict';

/**
 * Inicialización de Sentry (error monitoring).
 * DEBE cargarse ANTES que cualquier otro módulo (express, pg). Por eso se
 * requiere en la PRIMERA línea de index.js.
 *
 * Diseño v1.0 (plan free de Sentry):
 *  - Solo errores. Sin performance/tracing (tracesSampleRate: 0) para no
 *    consumir la cuota de 5,000 eventos/mes con transacciones.
 *  - Sin PII (sendDefaultPii: false): no se envían datos de usuario.
 *  - Si SENTRY_DSN no está definido (dev/test), Sentry queda inerte.
 */

require('dotenv').config();

const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN || undefined,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.NODE_ENV || 'development',
  // Free tier: SOLO errores. Nada de performance.
  tracesSampleRate: 0,
  // Privacidad: no enviar datos de usuario ni cuerpos de request.
  sendDefaultPii: false,
});
