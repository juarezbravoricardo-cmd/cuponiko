'use strict';

/**
 * Pool único de conexiones a Postgres (Supabase session pooler).
 * - SSL obligatorio (Supabase).
 * - Helper `withTransaction(fn)` para envolver BEGIN/COMMIT/ROLLBACK.
 *   REGLA AP-03: operaciones multi-tabla DEBEN usar withTransaction.
 */

const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[pg pool error]', err.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Ejecuta `fn(client)` dentro de una transacción.
 * Rollback automático en cualquier excepción.
 * @param {(client: import('pg').PoolClient) => Promise<any>} fn
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* noop */ }
    throw err;
  } finally {
    client.release();
  }
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, withTransaction, close };
