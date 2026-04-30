'use strict';

/**
 * planChecker — helpers que se consumen desde los services antes de
 * ejecutar una acción que depende del plan del negocio (free vs premium).
 *
 * Analogía: el portero del evento. No deja entrar a más de 3 personas con
 * boleto "Gratuito"; los de "VIP/Premium" pasan sin límite.
 *
 * - Fase Free: máximo 3 cupones `status = 'active'` simultáneamente.
 * - Fase Premium: sin límite. Acceso a `transferable = true` y a anuncios.
 *
 * Estos asserts DEBEN correrse DENTRO de la transacción que luego inserta el
 * cupón o actualiza status, para evitar race conditions (p.ej. dos requests
 * creando el cupón #4 casi simultáneos).
 */

const { AppError } = require('../utils/AppError');

/**
 * Devuelve el plan y status del negocio asociado al user_id (rol business).
 * @param {import('pg').PoolClient | { query:Function }} client — pool o client en transacción
 * @param {number} userId
 * @returns {Promise<{ id:number, plan:'free'|'premium', status:'active'|'inactive'|'suspended' }>}
 */
async function getBusinessByUserId(client, userId) {
  const r = await client.query(
    `SELECT id, plan, status FROM businesses WHERE user_id = $1`,
    [userId]
  );
  if (r.rowCount === 0) {
    throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Negocio no encontrado.');
  }
  return r.rows[0];
}

/**
 * Valida que el negocio esté activo.
 */
function assertBusinessActive(business) {
  if (business.status !== 'active') {
    throw new AppError(403, 'BUSINESS_SUSPENDED', 'Tu negocio está suspendido.');
  }
}

/**
 * Si el plan es free y el negocio ya tiene 3 o más cupones `active`, lanza 403.
 * @param {import('pg').PoolClient | { query:Function }} client
 * @param {number} businessId
 * @param {'free'|'premium'} plan
 */
async function assertCanActivateMoreCoupons(client, businessId, plan) {
  if (plan === 'premium') return;
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM coupons WHERE business_id = $1 AND status = 'active'`,
    [businessId]
  );
  if (r.rows[0].n >= 3) {
    throw new AppError(
      403,
      'PLAN_LIMIT',
      'Tu plan Gratuito permite máximo 3 cupones activos. Actualiza a Premium para crear más.'
    );
  }
}

/**
 * Variante usada al REACTIVAR un cupón `paused_by_downgrade` en plan free.
 * Mensaje del contrato CPN-04 validación 3.
 */
async function assertCanReactivatePausedByDowngrade(client, businessId, plan) {
  if (plan === 'premium') return;
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM coupons WHERE business_id = $1 AND status = 'active'`,
    [businessId]
  );
  if (r.rows[0].n >= 3) {
    throw new AppError(
      403,
      'PLAN_LIMIT',
      'Ya tienes 3 cupones activos. Actualiza a Premium para reactivar más.'
    );
  }
}

/**
 * Si se pide `transferable = true` pero el plan es free, lanza 403.
 */
function assertTransferableAllowed(plan, transferable) {
  if (transferable && plan !== 'premium') {
    throw new AppError(
      403,
      'PLAN_REQUIRED',
      'Los cupones transferibles son exclusivos del plan Premium.'
    );
  }
}

module.exports = {
  getBusinessByUserId,
  assertBusinessActive,
  assertCanActivateMoreCoupons,
  assertCanReactivatePausedByDowngrade,
  assertTransferableAllowed,
};
