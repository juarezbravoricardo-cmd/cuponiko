'use strict';

/**
 * jobsService — Scheduled jobs internos (Fase 3, BP-10).
 *
 * Jobs:
 *  - INTERNAL-01 coupon_expiry_notifier      (cada hora — pg_cron)
 *  - INTERNAL-02 loyalty_inactivity_tagger   (diario 02:00 — pg_cron)
 *  - INTERNAL-03 cleanup_expired_pdfs        (diario 03:00 — pg_cron)
 *
 * Cada ejecución registra una fila en `scheduled_jobs_log` con
 * status: 'success' | 'partial' | 'failed' y duration_ms.
 *
 * Reglas:
 *  - AP-01: las queries críticas usan UPDATE/INSERT con WHERE NOT EXISTS para
 *           idempotencia.
 *  - AP-08: errores se loguean estructurados, nunca se silencian.
 */

const { query, withTransaction } = require('../config/db');
const logger = require('../utils/logger');

// ────────────────────────────────────────────────────────────
// INTERNAL-01 — coupon_expiry_notifier
// ────────────────────────────────────────────────────────────
async function couponExpiryNotifier() {
  const start = Date.now();
  let processed = 0;
  let status = 'success';
  let errorDetail = null;

  try {
    // Selecciona instancias cuyo cupón vence en ≤ 24h y aún no fueron notificadas
    // (NOT EXISTS evita duplicados en runs siguientes).
    const r = await query(`
      SELECT ci.id              AS instance_id,
             ci.consumer_id,
             c.id               AS coupon_id,
             c.title,
             c.end_date,
             b.business_name
        FROM coupon_instances ci
        JOIN coupons    c ON c.id = ci.coupon_id
        JOIN businesses b ON b.id = c.business_id
       WHERE (c.end_date::timestamptz + INTERVAL '1 day' - INTERVAL '1 second')
             BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
         AND c.status = 'active'
         AND ci.uses_count < c.usage_limit_per_user
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
            WHERE n.user_id = ci.consumer_id
              AND n.type    = 'coupon_expiry_reminder'
              AND n.data->>'coupon_id' = c.id::text
              AND n.created_at > NOW() - INTERVAL '25 hours'
         )
       LIMIT 5000
    `);

    for (const row of r.rows) {
      try {
        await query(
          `INSERT INTO notifications (user_id, type, title, body, data)
           VALUES ($1, 'coupon_expiry_reminder', $2, $3, $4::jsonb)`,
          [
            row.consumer_id,
            'Tu cupón vence pronto',
            `El cupón "${row.title}" de ${row.business_name} vence en menos de 24 horas.`,
            JSON.stringify({ coupon_id: Number(row.coupon_id), instance_id: Number(row.instance_id) }),
          ]
        );
        processed += 1;
      } catch (err) {
        status = 'partial';
        errorDetail = (errorDetail || '') + `[${row.instance_id}:${err.message}]`;
        logger.error('coupon_expiry_notify_row_failed', { message: err.message, instance: row.instance_id });
      }
    }
  } catch (err) {
    status = 'failed';
    errorDetail = err.message;
    logger.error('coupon_expiry_notifier_failed', { message: err.message });
  }

  const durationMs = Date.now() - start;
  await query(
    `INSERT INTO scheduled_jobs_log (job_name, ran_at, records_processed, status, error_detail, duration_ms)
     VALUES ('coupon_expiry_notifier', NOW(), $1, $2::job_status, $3, $4)`,
    [processed, status, errorDetail, durationMs]
  );

  return { job: 'coupon_expiry_notifier', processed, status, duration_ms: durationMs };
}

// ────────────────────────────────────────────────────────────
// INTERNAL-02 — loyalty_inactivity_tagger
// ────────────────────────────────────────────────────────────
async function loyaltyInactivityTagger() {
  const start = Date.now();
  let processed = 0;
  let status = 'success';
  let errorDetail = null;

  try {
    // Calcula segmentos por par (consumer_id, business_id) basándose en
    // las redenciones de los últimos 30 días.
    //
    // No tenemos tabla `consumer_segments` separada — guardamos el segmento
    // como evento idempotente en `activity_logs` con action='loyalty_segment'
    // (uno por par por día) para que el panel admin/business lo consuma.
    const r = await query(`
      SELECT consumer_id,
             business_id,
             MAX(redeemed_at) AS last_interaction,
             COUNT(*) FILTER (WHERE redeemed_at > NOW() - INTERVAL '30 days')::int AS count_30d
        FROM redemptions
       GROUP BY consumer_id, business_id
    `);

    for (const row of r.rows) {
      let segment;
      const last = row.last_interaction ? new Date(row.last_interaction) : null;
      const daysSince = last ? (Date.now() - last.getTime()) / 86400000 : 9999;
      if (row.count_30d > 3) segment = 'frecuente';
      else if (daysSince <= 30) segment = 'activo';
      else segment = 'inactivo';

      try {
        // Idempotencia diaria: si ya hay un registro hoy del mismo par, lo
        // actualizamos vía nuevo INSERT — el panel toma el más reciente.
        await query(
          `INSERT INTO activity_logs (user_id, business_id, action, metadata)
           VALUES ($1, $2, 'loyalty_segment', $3::jsonb)`,
          [
            row.consumer_id,
            row.business_id,
            JSON.stringify({
              segment,
              count_30d: row.count_30d,
              last_interaction: last ? last.toISOString() : null,
            }),
          ]
        );
        processed += 1;
      } catch (err) {
        status = 'partial';
        errorDetail = (errorDetail || '') + `[${row.consumer_id}-${row.business_id}:${err.message}]`;
        logger.error('loyalty_segment_insert_failed', { message: err.message });
      }
    }
  } catch (err) {
    status = 'failed';
    errorDetail = err.message;
    logger.error('loyalty_inactivity_tagger_failed', { message: err.message });
  }

  const durationMs = Date.now() - start;
  await query(
    `INSERT INTO scheduled_jobs_log (job_name, ran_at, records_processed, status, error_detail, duration_ms)
     VALUES ('loyalty_inactivity_tagger', NOW(), $1, $2::job_status, $3, $4)`,
    [processed, status, errorDetail, durationMs]
  );

  return { job: 'loyalty_inactivity_tagger', processed, status, duration_ms: durationMs };
}

// ────────────────────────────────────────────────────────────
// INTERNAL-03 — cleanup_expired_pdfs
// ────────────────────────────────────────────────────────────
async function cleanupExpiredPdfs() {
  const start = Date.now();
  let processed = 0;
  let status = 'success';
  let errorDetail = null;

  try {
    // El borrado real ocurre contra Supabase Storage bucket 'exports-pdf'.
    // Aquí registramos la intención: marcamos como 'cleaned' las entradas en
    // activity_logs con action='pdf_export_completed' anteriores a 24h.
    const r = await query(`
      WITH expired AS (
        SELECT id
          FROM activity_logs
         WHERE action = 'pdf_export_completed'
           AND created_at < NOW() - INTERVAL '24 hours'
           AND COALESCE((metadata->>'cleaned')::boolean, FALSE) = FALSE
         LIMIT 5000
      )
      UPDATE activity_logs al
         SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('cleaned', true, 'cleaned_at', NOW())
       WHERE al.id IN (SELECT id FROM expired)
      RETURNING al.id
    `);
    processed = r.rowCount;
  } catch (err) {
    status = 'failed';
    errorDetail = err.message;
    logger.error('cleanup_expired_pdfs_failed', { message: err.message });
  }

  const durationMs = Date.now() - start;
  await query(
    `INSERT INTO scheduled_jobs_log (job_name, ran_at, records_processed, status, error_detail, duration_ms)
     VALUES ('cleanup_expired_pdfs', NOW(), $1, $2::job_status, $3, $4)`,
    [processed, status, errorDetail, durationMs]
  );

  return { job: 'cleanup_expired_pdfs', processed, status, duration_ms: durationMs };
}

module.exports = {
  couponExpiryNotifier,
  loyaltyInactivityTagger,
  cleanupExpiredPdfs,
};
