'use strict';

/**
 * Cache in-memory para reducir carga sobre PostgreSQL (Grupo A — blindaje TikTok).
 *
 * Analogía: en vez de ir al supermercado por cada huevo, tienes una canasta
 * en la cocina con los más usados. Si lo que pides no está en la canasta
 * (cache miss), entonces vas al super (DB) y de paso lo guardas para la
 * próxima.
 *
 * 3 caches independientes con TTLs diferentes:
 *  - geoCache (5 min):              negocios cercanos por zona geográfica
 *  - couponListCache (2 min):       lista de cupones activos / carrusel ads
 *  - businessProfileCache (10 min): datos del perfil público de cada negocio
 *
 * Invalidación: cuando un negocio modifica datos o cupones, se llama a
 * `invalidateBusinessCaches(businessId)` para refrescar las entradas
 * afectadas. Geo cache se vacía completo (regenera <50ms con índice GIST).
 *
 * Notas:
 *  - useClones: false ⇒ NO mutar los objetos retornados por el cache porque
 *    se comparte la referencia (mejor performance, mismo contrato que la
 *    query original ya que mapeamos a un objeto plano y nuevo en cada query).
 *  - El cache es por proceso. Para multi-instancia habría que mover a Redis.
 *    Para v1.0 con 1 réplica de Railway es suficiente.
 */

const NodeCache = require('node-cache');

const geoCache = new NodeCache({
  stdTTL: 300, // 5 minutos
  checkperiod: 60, // limpia expirados cada 60s
  useClones: false,
});

const couponListCache = new NodeCache({
  stdTTL: 120, // 2 minutos
  checkperiod: 30,
  useClones: false,
});

const businessProfileCache = new NodeCache({
  stdTTL: 600, // 10 minutos
  checkperiod: 60,
  useClones: false,
});

/**
 * Key generator para geo cache.
 * Redondea coordenadas a 3 decimales (~111 metros de precisión) para que
 * usuarios cercanos compartan la misma entrada de cache. Incluye `radius`
 * y `category` porque cambian el resultado.
 */
function geoKey(lat, lng, radius, category) {
  const latR = Math.round(Number(lat) * 1000) / 1000;
  const lngR = Math.round(Number(lng) * 1000) / 1000;
  const cat = category && String(category).trim() ? String(category).trim() : 'all';
  return `geo:${latR}:${lngR}:${radius}:${cat}`;
}

/**
 * Helper: si está en cache, lo retorna. Si no, ejecuta `fn`,
 * guarda el resultado y lo retorna.
 *
 * IMPORTANTE: si `fn` lanza, NO se cachea — se propaga el error tal cual,
 * para no envenenar el cache con errores transitorios.
 */
async function getOrSet(cache, key, fn) {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const result = await fn();
  cache.set(key, result);
  return result;
}

/**
 * Invalida el cache asociado a un negocio cuando crea/edita/pausa cupones,
 * crea anuncios o cambia su plan vía webhook de Stripe.
 *
 * Se vacía geoCache completo: las queries de HOME-01 son baratas (<50ms con
 * índice GIST) y la lista de zonas es chica.
 */
function invalidateBusinessCaches(businessId) {
  const id = Number(businessId);
  if (!Number.isFinite(id) || id <= 0) return;

  businessProfileCache.del(`biz:${id}`);

  // geo cache: vaciar todo (cheap)
  geoCache.flushAll();

  // coupon list cache: borrar entradas que mencionen este businessId
  // (HOME-03 carrusel + cualquier lista por negocio)
  const idStr = String(id);
  for (const k of couponListCache.keys()) {
    if (k.includes(idStr) || k.startsWith('carousel:')) {
      couponListCache.del(k);
    }
  }
}

/**
 * Estadísticas para monitoring (expuesto en GET /internal/cache-stats).
 */
function getStats() {
  return {
    geo: geoCache.getStats(),
    couponList: couponListCache.getStats(),
    businessProfile: businessProfileCache.getStats(),
    keys: {
      geo: geoCache.keys().length,
      couponList: couponListCache.keys().length,
      businessProfile: businessProfileCache.keys().length,
    },
  };
}

/**
 * Helper para tests — vacía todos los caches.
 */
function _flushAll() {
  geoCache.flushAll();
  couponListCache.flushAll();
  businessProfileCache.flushAll();
}

module.exports = {
  geoCache,
  couponListCache,
  businessProfileCache,
  geoKey,
  getOrSet,
  invalidateBusinessCaches,
  getStats,
  _flushAll,
};
