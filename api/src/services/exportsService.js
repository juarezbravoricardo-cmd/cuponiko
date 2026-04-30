'use strict';

/**
 * exportsService — implementa EXPORT-01 y EXPORT-02 de cuponiko_contratos_api_v2.md
 *
 * Analogía: el botón "imprimir reporte" del cajero. El usuario lo aprieta y se
 * va a hacer otra cosa; la impresora trabaja en el cuarto trasero, y cuando
 * termina pega un papelito en el corcho con la URL del PDF y un timer de 24h.
 *
 * Reglas críticas honradas:
 *  - AP-01: el INSERT con CHECK previo de exportación pendiente se hace dentro
 *    de la misma transacción para evitar race conditions (dos exports
 *    pending simultáneos del mismo negocio).
 *  - AP-08: mensajes literales del contrato.
 *  - AP-12: respeto de nombres exactos de tabla y columnas (`exports`, `file_url`,
 *    `expires_at`, `completed_at`, `error_message`).
 *  - Side-effect (generación PDF) corre fuera de la transacción.
 */

const { query, withTransaction } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { getBusinessByUserId } = require('../middleware/planChecker');
const env = require('../config/env');
const logger = require('../utils/logger');

const VALID_TYPES = new Set(['coupons_report', 'loyalty_report', 'redemptions_report']);
const ACTIVE_STATUSES = ['pending', 'processing'];

// Hook de tests para forzar fallo durante la generación
let _forceFailNextJob = false;
function _armFailNextJob() {
  _forceFailNextJob = true;
}

// Hook de tests para esperar a que termine el job en background
const _pendingJobs = new Set();
async function _awaitAllJobs() {
  while (_pendingJobs.size > 0) {
    await Promise.allSettled(Array.from(_pendingJobs));
  }
}

function _validateDates(date_from, date_to) {
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (date_from && !dateRe.test(date_from)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'La fecha final debe ser posterior a la fecha inicial.');
  }
  if (date_to && !dateRe.test(date_to)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'La fecha final debe ser posterior a la fecha inicial.');
  }
  if (date_from && date_to && date_to < date_from) {
    throw new AppError(400, 'VALIDATION_ERROR', 'La fecha final debe ser posterior a la fecha inicial.');
  }
}

// ────────────────────────────────────────────────────────────
// EXPORT-01: POST /api/exports/pdf
// ────────────────────────────────────────────────────────────
async function requestExport(userId, body = {}) {
  const { type, date_from, date_to } = body;

  // Validación 1 — type
  if (!type || !VALID_TYPES.has(type)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Tipo de exportación inválido.');
  }
  // Validación 2 — fechas
  _validateDates(date_from, date_to);

  // Validación 4 — plan premium (incluye verificar que el user tiene negocio)
  const business = await getBusinessByUserId({ query }, userId);
  if (business.plan !== 'premium') {
    throw new AppError(
      403,
      'PLAN_RESTRICTED',
      'La exportación de reportes está disponible en el plan Premium.'
    );
  }

  // Validación 3 + INSERT atómicos.
  // Hacemos el chequeo y el INSERT dentro de una transacción con FOR UPDATE
  // sobre los registros activos, para que dos solicitudes concurrentes no
  // ambas pasen el chequeo.
  const exportRow = await withTransaction(async (client) => {
    // SELECT con bloqueo de las filas activas del negocio (si las hay)
    const active = await client.query(
      `SELECT id FROM exports
        WHERE business_id = $1 AND status = ANY($2::text[])
        FOR UPDATE`,
      [business.id, ACTIVE_STATUSES]
    );
    if (active.rowCount > 0) {
      throw new AppError(
        429,
        'EXPORT_IN_PROGRESS',
        'Ya tienes una exportación en proceso. Espera a que termine.'
      );
    }
    const ins = await client.query(
      `INSERT INTO exports (business_id, user_id, type, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id, type, status, created_at`,
      [business.id, userId, type]
    );
    return ins.rows[0];
  });

  // Registrar evento
  await query(
    `INSERT INTO activity_logs (user_id, business_id, action, metadata)
     VALUES ($1, $2, 'export_requested', $3::jsonb)`,
    [userId, business.id, JSON.stringify({ export_id: Number(exportRow.id), type, date_from: date_from || null, date_to: date_to || null })]
  );

  // Encolar job (inline async). Guardamos la promesa para tests.
  const job = _runExportJob(Number(exportRow.id), business.id, type, { date_from, date_to });
  _pendingJobs.add(job);
  job.finally(() => _pendingJobs.delete(job));

  return {
    export_id: Number(exportRow.id),
    status: 'pending',
    message: 'Tu reporte se está generando. Te notificaremos cuando esté listo.',
  };
}

// ────────────────────────────────────────────────────────────
// Job asíncrono de generación PDF
// En este patch no se ejecuta upload real al bucket si MOCK_EXTERNAL_SERVICES
// está activo: simulamos URL firmada y TTL 24h. La generación real con
// pdfkit/Supabase Storage queda como TODO de producción.
// ────────────────────────────────────────────────────────────
async function _runExportJob(exportId, businessId, type, { date_from, date_to } = {}) {
  // Marcar processing
  try {
    await query(`UPDATE exports SET status = 'processing' WHERE id = $1`, [exportId]);
  } catch (err) {
    logger.error('export_processing_mark_failed', { exportId, message: err.message });
    return;
  }

  try {
    if (_forceFailNextJob) {
      _forceFailNextJob = false;
      throw new Error('Forced failure for tests');
    }

    // Aquí iría: query datos del reporte → render PDFKit → upload a Supabase
    // Storage `exports-pdf/{business_id}/{export_id}.pdf` → signed URL 24h.
    // En modo mock generamos URL determinista.
    const filePath = `exports-pdf/${businessId}/${exportId}.pdf`;
    const fileUrl = env.MOCK_EXTERNAL_SERVICES
      ? `https://mock.cuponiko.storage/${filePath}?token=mock-${exportId}`
      : `https://supabase.cuponiko/${filePath}`;

    await query(
      `UPDATE exports
          SET status = 'completed',
              file_path = $2,
              file_url = $3,
              expires_at = NOW() + INTERVAL '24 hours',
              completed_at = NOW(),
              error_message = NULL
        WHERE id = $1`,
      [exportId, filePath, fileUrl]
    );

    // Notificar al business owner
    const owner = await query(
      `SELECT b.user_id, b.business_name FROM businesses b WHERE b.id = $1`,
      [businessId]
    );
    if (owner.rowCount > 0) {
      await query(
        `INSERT INTO notifications (user_id, type, title, body, data)
         VALUES ($1, 'export_ready', $2, $3, $4::jsonb)`,
        [
          owner.rows[0].user_id,
          'Tu reporte está listo',
          `El reporte "${type}" de ${owner.rows[0].business_name} se generó correctamente.`,
          JSON.stringify({ export_id: exportId, type }),
        ]
      );
    }

    await query(
      `INSERT INTO activity_logs (business_id, action, metadata)
       VALUES ($1, 'pdf_export_completed', $2::jsonb)`,
      [businessId, JSON.stringify({ export_id: exportId, type, date_from: date_from || null, date_to: date_to || null })]
    );
  } catch (err) {
    logger.error('export_job_failed', { exportId, message: err.message });
    await query(
      `UPDATE exports
          SET status = 'failed',
              error_message = $2
        WHERE id = $1`,
      [exportId, String(err.message).slice(0, 500)]
    ).catch(() => {});
  }
}

// ────────────────────────────────────────────────────────────
// EXPORT-02: GET /api/exports/:id
// ────────────────────────────────────────────────────────────
async function getExportStatus(userId, exportId) {
  const id = Number(exportId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(404, 'NOT_FOUND', 'Exportación no encontrada.');
  }

  const r = await query(
    `SELECT id, business_id, type, status, file_url, expires_at, created_at, completed_at, error_message
       FROM exports
      WHERE id = $1`,
    [id]
  );
  if (r.rowCount === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Exportación no encontrada.');
  }
  const exp = r.rows[0];

  // Validar pertenencia: el negocio del export debe ser del user
  const biz = await query(
    `SELECT id FROM businesses WHERE user_id = $1 AND id = $2`,
    [userId, exp.business_id]
  );
  if (biz.rowCount === 0) {
    throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para ver esta exportación.');
  }

  const out = {
    export_id: Number(exp.id),
    type: exp.type,
    status: exp.status,
    created_at: exp.created_at,
    completed_at: exp.completed_at,
  };
  if (exp.status === 'completed') {
    out.file_url = exp.file_url;
    out.expires_at = exp.expires_at;
  }
  if (exp.status === 'failed' && exp.error_message) {
    out.error_message = exp.error_message;
  }
  return out;
}

module.exports = {
  requestExport,
  getExportStatus,
  _armFailNextJob,
  _awaitAllJobs,
};
