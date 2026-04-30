'use strict';

/**
 * Servicio de geocoding (dirección → lat/lng/display_address).
 *
 * Producción: Google Maps Geocoding API.
 * Mock: resuelve cualquier dirección que contenga una palabra "válida".
 *       Falla si la dirección contiene "xyzinvalido" o empieza con '!' —
 *       permite escribir tests deterministas (T-110/T-111).
 */

const env = require('../config/env');
const { AppError } = require('../utils/AppError');

async function geocodeAddress(addressInput) {
  if (!addressInput || typeof addressInput !== 'string' || addressInput.trim().length < 3) {
    throw new AppError(
      400,
      'GEOCODING_FAILED',
      'No pudimos verificar tu dirección. Intenta de nuevo o ingresa una dirección más específica.'
    );
  }

  if (env.MOCK_EXTERNAL_SERVICES) {
    const normalized = addressInput.trim();
    const fail =
      /xyzinvalido/i.test(normalized) ||
      normalized.startsWith('!') ||
      normalized.length < 5;
    if (fail) {
      throw new AppError(
        400,
        'GEOCODING_FAILED',
        'No pudimos verificar tu dirección. Intenta de nuevo o ingresa una dirección más específica.'
      );
    }
    // Devuelve un punto determinista en CDMX (Zócalo)
    return {
      lat: 19.4326,
      lng: -99.1332,
      display_address: normalized.replace(/\s+/g, ' '),
    };
  }

  // Producción: Google Maps Geocoding API
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?address=${encodeURIComponent(addressInput)}&key=${env.GOOGLE_MAPS_API_KEY}`;

  let resp;
  try {
    resp = await fetch(url, { method: 'GET' });
  } catch (_err) {
    throw new AppError(
      400,
      'GEOCODING_FAILED',
      'No pudimos verificar tu dirección. Intenta de nuevo o ingresa una dirección más específica.'
    );
  }

  if (!resp.ok) {
    throw new AppError(
      400,
      'GEOCODING_FAILED',
      'No pudimos verificar tu dirección. Intenta de nuevo o ingresa una dirección más específica.'
    );
  }
  const data = await resp.json();
  if (data.status !== 'OK' || !Array.isArray(data.results) || data.results.length === 0) {
    throw new AppError(
      400,
      'GEOCODING_FAILED',
      'No pudimos verificar tu dirección. Intenta de nuevo o ingresa una dirección más específica.'
    );
  }
  const best = data.results[0];
  return {
    lat: Number(best.geometry.location.lat),
    lng: Number(best.geometry.location.lng),
    display_address: best.formatted_address,
  };
}

module.exports = { geocodeAddress };
