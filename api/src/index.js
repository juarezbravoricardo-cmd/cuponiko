'use strict';

const env = require('./config/env');
const { buildApp } = require('./app');
const logger = require('./utils/logger');

const app = buildApp();

// Bind a 0.0.0.0 (no 'localhost') es obligatorio para Railway y para que
// dispositivos en LAN puedan alcanzar el API durante desarrollo.
const PORT = env.PORT;
const server = app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`Cuponiko API running on port ${PORT}`);
  logger.info('api_listening', { port: PORT, env: env.NODE_ENV });
});

function shutdown(signal) {
  logger.info('api_shutdown', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref?.();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
