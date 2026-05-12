'use strict';

/**
 * adminService — Panel admin (Fase 3).
 *
 * Endpoints:
 *  - ADMIN-01 GET    /api/admin/businesses
 *  - ADMIN-02 PATCH  /api/admin/businesses/:id/suspend
 *  - ADMIN-03 PATCH  /api/admin/businesses/:id/activate
 *  - ADMIN-04 GET    /api/admin/alerts
 *  - ADMIN-05 PATCH  /api/admin/alerts/:id/resolve
 *  - ADMIN-06 PATCH  /api/admin/users/:id/block
 *  - ADMIN-07 POST   /api/alerts/report                (business)
 *  - ADMIN-08 GET    /api/admin/metrics
 *
 * Reglas:
 *  - AP-01: UPDATE atómico con WHERE/RETURNING.
 *  - AP-02: nunca SELECT-then-UPDATE.
 *  - AP-08: mensajes literales del contrato.
 *  - ADMIN-02: el cupón NO se cambia de status — sólo el negocio.
 *  - ADMIN-06: borrado lógico (is_active=false), elimina push_token + sesiones.
 */

const { query, withTransaction } = require('../config/db');
const { AppError } = require('../utils/AppError');
const logger = require('../utils/logger');

const PAGE_SIZE = 20;
const ALERT_RESOLVE_ACTIONS = new Set(['ignore', 'block_consumer', 'suspend_business']);

// ────────────────────────────────────────────────────────────
// ADMIN-01 — Listar negocios
// ────────────────────────────────────────────────────────────
async function listBusinesses({ status, search, page }) {
  const params = [];
  const where = ['1=1'];
  if (status && ['active', 'inactive', 'suspended'].includes(status)) {
    params.push(status);
    where.push(`b.status = $${params.length}`);
  }
  if (search && typeof search === 'string' && search.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    where.push(`LOWER(b.business_name) LIKE $${params.length}`);
  }
  const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;
  params.push(PAGE_SIZE, offset);

  const r = await query(
    `SELECT b.id, b.business_name, b.category, b.plan, b.status, b.created_at,
            u.email AS owner_email, u.full_name AS owner_name,
            (SELECT COUNT(*) FROM coupons c WHERE c.business_id = b.id AND c.status='active')::int AS active_coupons
       FROM businesses b
       JOIN users u ON u.id = b.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY b.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    page: pageNum,
    page_size: PAGE_SIZE,
    businesses: r.rows.map((x) => ({
      id: Number(x.id),
      business_name: x.business_name,
      category: x.category,
      plan: x.plan,
      status: x.status,
      owner_email: x.owner_email,
      owner_name: x.owner_name,
      active_coupons: x.active_coupons,
      created_at: x.created_at,
    })),
  };
}

// ────────────────────────────────────────────────────────────
// ADMIN-02 — Suspender negocio
// ────────────────────────────────────────────────────────────
async function suspendBusiness(adminId, businessIdRaw) {
  const businessId = Number(businessIdRaw);
  if (!Number.isFinite(businessId) || businessId <= 0) {
    throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Negocio no encontrado.');
  }

  return withTransaction(async (client) => {
    // UPDATE atómico (AP-01) — sólo si está active/inactive (no re-suspender)
    const upd = await client.query(
      `UPDATE businesses
          SET status = 'suspended', updated_at = NOW()
        WHERE id = $1 AND status IN ('active', 'inactive')
        RETURNING id, status, business_name, user_id`,
      [businessId]
    );
    if (upd.rowCount === 0) {
      const probe = await client.query('SELECT id, status FROM businesses WHERE id = $1', [businessId]);
      if (probe.rowCount === 0) {
        throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Negocio no encontrado.');
      }
      throw new AppError(409, 'INVALID_STATE', 'El negocio ya está suspendido.');
    }
    const biz = upd.rows[0];

    // Notificar a consumidores con cupones activos del negocio
    const consumersRes = await client.query(
      `SELECT DISTINCT ci.consumer_id
         FROM coupon_instances ci
         JOIN coupons c ON c.id = ci.coupon_id
        WHERE c.business_id = $1 AND c.status = 'active'`,
      [businessId]
    );
    for (const row of consumersRes.rows) {
      try {
        await client.query(
          `INSERT INTO notifications (user_id, type, title, body, data)
           VALUES ($1, 'business_suspended', $2, $3, $4::jsonb)`,
          [
            row.consumer_id,
            'Negocio temporalmente no disponible',
            `${biz.business_name} no está disponible por ahora.`,
            JSON.stringify({ business_id: Number(businessId) }),
          ]
        );
      } catch (err) {
        logger.error('suspend_notify_failed', { message: err.message });
      }
    }

    await client.query(
      `INSERT INTO activity_logs (user_id, business_id, action, metadata)
       VALUES ($1, $2, 'admin_business_suspended', $3::jsonb)`,
      [adminId, businessId, JSON.stringify({ admin_id: Number(adminId) })]
    );

    return {
      business_id: Number(businessId),
      status: 'suspended',
      affected_consumers: consumersRes.rowCount,
      message: 'Negocio suspendido.',
    };
  });
}

// ────────────────────────────────────────────────────────────
// ADMIN-03 — Reactivar negocio
// ────────────────────────────────────────────────────────────
async function activateBusiness(adminId, businessIdRaw) {
  const businessId = Number(businessIdRaw);
  if (!Number.isFinite(businessId) || businessId <= 0) {
    throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Negocio no encontrado.');
  }
  const upd = await query(
    `UPDATE businesses
        SET status = 'active', updated_at = NOW()
      WHERE id = $1 AND status = 'suspended'
      RETURNING id, status`,
    [businessId]
  );
  if (upd.rowCount === 0) {
    const probe = await query('SELECT id, status FROM businesses WHERE id = $1', [businessId]);
    if (probe.rowCount === 0) {
      throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Negocio no encontrado.');
    }
    throw new AppError(409, 'INVALID_STATE', 'El negocio no está suspendido.');
  }
  await query(
    `INSERT INTO activity_logs (user_id, business_id, action, metadata)
     VALUES ($1, $2, 'admin_business_activated', $3::jsonb)`,
    [adminId, businessId, JSON.stringify({ admin_id: Number(adminId) })]
  );
  return { business_id: Number(businessId), status: 'active' };
}

// ────────────────────────────────────────────────────────────
// ADMIN-04 — Listar alertas antifraude
// ────────────────────────────────────────────────────────────
async function listAlerts({ resolved, type, page }) {
  const params = [];
  const where = [];
  if (resolved === 'true' || resolved === true) {
    where.push('resolved = TRUE');
  } else if (resolved === 'false' || resolved === false) {
    where.push('resolved = FALSE');
  }
  if (type && typeof type === 'string') {
    params.push(type);
    where.push(`type = $${params.length}`);
  }
  const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;
  params.push(PAGE_SIZE, offset);

  const sql = `
    SELECT id, type, severity, description, consumer_id, business_id,
           resolved, resolved_by, resolved_at, created_at
      FROM alerts
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}
  `;
  const r = await query(sql, params);
  return {
    page: pageNum,
    page_size: PAGE_SIZE,
    alerts: r.rows.map((a) => ({
      id: Number(a.id),
      type: a.type,
      severity: a.severity,
      description: a.description,
      consumer_id: a.consumer_id ? Number(a.consumer_id) : null,
      business_id: a.business_id ? Number(a.business_id) : null,
      resolved: a.resolved,
      resolved_by: a.resolved_by ? Number(a.resolved_by) : null,
      resolved_at: a.resolved_at,
      created_at: a.created_at,
    })),
  };
}

// ────────────────────────────────────────────────────────────
// ADMIN-05 — Resolver alerta
// ────────────────────────────────────────────────────────────
async function resolveAlert(adminId, alertIdRaw, body) {
  const alertId = Number(alertIdRaw);
  if (!Number.isFinite(alertId) || alertId <= 0) {
    throw new AppError(404, 'ALERT_NOT_FOUND', 'Alerta no encontrada.');
  }
  const action = (body || {}).action;
  if (!ALERT_RESOLVE_ACTIONS.has(action)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Acción inválida.');
  }

  return withTransaction(async (client) => {
    // UPDATE atómico
    const upd = await client.query(
      `UPDATE alerts
          SET resolved = TRUE, resolved_by = $1, resolved_at = NOW()
        WHERE id = $2 AND resolved = FALSE
        RETURNING id, type, consumer_id, business_id`,
      [adminId, alertId]
    );
    if (upd.rowCount === 0) {
      const probe = await client.query('SELECT id, resolved FROM alerts WHERE id = $1', [alertId]);
      if (probe.rowCount === 0) {
        throw new AppError(404, 'ALERT_NOT_FOUND', 'Alerta no encontrada.');
      }
      throw new AppError(409, 'ALREADY_RESOLVED', 'La alerta ya está resuelta.');
    }
    const alert = upd.rows[0];

    // Acciones colaterales
    if (action === 'block_consumer') {
      const consumerId = Number((body && body.consumer_id) || alert.consumer_id);
      if (consumerId > 0) await _blockConsumerInTx(client, adminId, consumerId);
    } else if (action === 'suspend_business') {
      const bizId = Number((body && body.business_id) || alert.business_id);
      if (bizId > 0) {
        // mismo flujo que ADMIN-02 pero dentro de la misma tx
        await client.query(
          `UPDATE businesses SET status='suspended', updated_at=NOW()
            WHERE id = $1 AND status IN ('active','inactive')`,
          [bizId]
        );
      }
    }

    await client.query(
      `INSERT INTO activity_logs (user_id, business_id, action, metadata)
       VALUES ($1, $2, 'admin_alert_resolved', $3::jsonb)`,
      [adminId, alert.business_id, JSON.stringify({ alert_id: alertId, action })]
    );

    return { alert_id: alertId, action, resolved: true };
  });
}

async function _blockConsumerInTx(client, adminId, consumerId) {
  const upd = await client.query(
    `UPDATE users
        SET is_active = FALSE, push_token = NULL, updated_at = NOW()
      WHERE id = $1 AND role = 'consumer'
      RETURNING id`,
    [consumerId]
  );
  if (upd.rowCount === 0) return false;
  await client.query(
    `INSERT INTO activity_logs (user_id, action, metadata)
     VALUES ($1, 'admin_consumer_blocked', $2::jsonb)`,
    [adminId, JSON.stringify({ blocked_user_id: Number(consumerId) })]
  );
  return true;
}

// ────────────────────────────────────────────────────────────
// ADMIN-06 — Bloquear consumidor
// ────────────────────────────────────────────────────────────
async function blockUser(adminId, userIdRaw) {
  const userId = Number(userIdRaw);
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
  }

  return withTransaction(async (client) => {
    const upd = await client.query(
      `UPDATE users
          SET is_active = FALSE, push_token = NULL, updated_at = NOW()
        WHERE id = $1 AND role = 'consumer'
        RETURNING id, is_active, push_token`,
      [userId]
    );
    if (upd.rowCount === 0) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
    }
    await client.query(
      `INSERT INTO activity_logs (user_id, action, metadata)
       VALUES ($1, 'admin_consumer_blocked', $2::jsonb)`,
      [adminId, JSON.stringify({ blocked_user_id: Number(userId) })]
    );
    return {
      user_id: Number(userId),
      is_active: false,
      message: 'Usuario bloqueado.',
    };
  });
}

// ────────────────────────────────────────────────────────────
// ADMIN-07 — Reportar fraude (business → admin)
// ────────────────────────────────────────────────────────────
async function reportAlert(userId, body) {
  const description = (body || {}).description;
  if (!description || typeof description !== 'string' || !description.trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Describe el problema.');
  }

  // Resolver business_id del reportero
  const bizRes = await query('SELECT id FROM businesses WHERE user_id = $1', [userId]);
  if (bizRes.rowCount === 0) {
    throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Negocio no encontrado.');
  }
  const businessId = Number(bizRes.rows[0].id);

  const consumerId = (body || {}).consumer_id ? Number((body || {}).consumer_id) : null;
  const couponId = (body || {}).coupon_id ? Number((body || {}).coupon_id) : null;

  const ins = await query(
    `INSERT INTO alerts (type, severity, description, consumer_id, business_id)
     VALUES ('manual_report', 'medium', $1, $2, $3)
     RETURNING id, type, severity, created_at`,
    [description.trim(), consumerId, businessId]
  );

  if (couponId) {
    await query(
      `INSERT INTO activity_logs (user_id, business_id, action, metadata)
       VALUES ($1, $2, 'fraud_report', $3::jsonb)`,
      [userId, businessId, JSON.stringify({ coupon_id: couponId, alert_id: Number(ins.rows[0].id) })]
    );
  }
  return {
    alert_id: Number(ins.rows[0].id),
    type: ins.rows[0].type,
    severity: ins.rows[0].severity,
    created_at: ins.rows[0].created_at,
    message: 'Reporte enviado.',
  };
}

// ────────────────────────────────────────────────────────────
// ADMIN-08 — Métricas globales
// ────────────────────────────────────────────────────────────
async function globalMetrics() {
  const r = await query(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE is_active = TRUE)::int                                      AS total_users,
      (SELECT COUNT(*) FROM businesses WHERE status = 'active')::int                                AS active_businesses,
      (SELECT COUNT(*) FROM coupons)::int                                                           AS coupons_created,
      (SELECT COUNT(*) FROM redemptions)::int                                                       AS coupons_redeemed,
      (SELECT COUNT(*) FROM businesses WHERE plan = 'premium' AND subscription_status='active')::int AS premium_active
  `);
  const row = r.rows[0];
  const redemptionRate = row.coupons_created > 0
    ? Number((row.coupons_redeemed / row.coupons_created).toFixed(4))
    : 0;
  // MRR conservador: PREMIUM_PRICE_MXN/mes × premium activos. (No exponemos IDs Stripe.)
  // Precio real del plan Premium: 399 MXN/mes. Se lee de env para no acoplar el monto al código
  // y permitir overrides en QA/staging sin re-deploy. Fallback a 399 (fuente de verdad: Stripe price).
  const PREMIUM_PRICE_MXN = parseInt(process.env.PREMIUM_PRICE_MXN, 10) || 399;
  const mrr = row.premium_active * PREMIUM_PRICE_MXN;
  return {
    total_users: row.total_users,
    active_businesses: row.active_businesses,
    coupons_created: row.coupons_created,
    coupons_redeemed: row.coupons_redeemed,
    redemption_rate: redemptionRate,
    mrr,
  };
}

module.exports = {
  listBusinesses,
  suspendBusiness,
  activateBusiness,
  listAlerts,
  resolveAlert,
  blockUser,
  reportAlert,
  globalMetrics,
};
