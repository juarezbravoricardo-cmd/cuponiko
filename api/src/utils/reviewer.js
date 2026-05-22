'use strict';

/**
 * reviewer.js — Helper para detectar cuentas de revisor de Google Play.
 *
 * Lee process.env.REVIEWER_USER_IDS (CSV de IDs numéricos, ej "2482,2479").
 * Si la variable no existe o está vacía, ningún usuario es revisor.
 */

const reviewerIds = new Set(
  (process.env.REVIEWER_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite)
);

/**
 * @param {number|string} userId
 * @returns {boolean}
 */
function isReviewer(userId) {
  return reviewerIds.has(Number(userId));
}

module.exports = { isReviewer };
