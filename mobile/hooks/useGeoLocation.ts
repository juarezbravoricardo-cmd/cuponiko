/**
 * useGeoLocation — hook de BP-12 "geolocalización con fallbacks".
 *
 * Analogía: un GPS que primero intenta leer la señal satelital (expo-location),
 * si el usuario no da permiso o no hay señal, pregunta al operador celular
 * (ip-location) y si todo falla asume "Centro de la ciudad".
 *
 * Orden de preferencia (BP-12):
 *   1. Permiso del sistema + posición actual (precisión alta).
 *   2. Última posición conocida del dispositivo.
 *   3. GET /api/geo/ip-location (fallback IP).
 *   4. Default fijo: CDMX (19.4326, -99.1332).
 *
 * Devuelve:
 *   - status: 'idle' | 'loading' | 'ready' | 'error'
 *   - coords: { lat, lng } | null
 *   - source: 'gps' | 'last_known' | 'ip' | 'default'
 *   - refresh(): reintentar la secuencia (por ej. tras conceder permisos).
 */

import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { fetchIpLocation } from '@/services/couponsApi';

type Source = 'gps' | 'last_known' | 'ip' | 'default';
type Status = 'idle' | 'loading' | 'ready' | 'error';

const DEFAULT_COORDS = { lat: 19.4326, lng: -99.1332 };

export function useGeoLocation() {
  const [status, setStatus] = useState<Status>('idle');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [source, setSource] = useState<Source>('default');
  const [error, setError] = useState<string | null>(null);

  const resolve = useCallback(async () => {
    setStatus('loading');
    setError(null);

    // 1. Permisos + GPS
    try {
      const { status: permStatus } = await Location.requestForegroundPermissionsAsync();
      if (permStatus === 'granted') {
        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setSource('gps');
          setStatus('ready');
          return;
        } catch {
          // intenta last known
          const last = await Location.getLastKnownPositionAsync();
          if (last) {
            setCoords({ lat: last.coords.latitude, lng: last.coords.longitude });
            setSource('last_known');
            setStatus('ready');
            return;
          }
        }
      }
    } catch {
      // sigue al fallback IP
    }

    // 2. Fallback IP
    try {
      const ip = await fetchIpLocation();
      setCoords({ lat: ip.lat, lng: ip.lng });
      setSource(ip.source === 'ip_geolocation' ? 'ip' : 'default');
      setStatus('ready');
      return;
    } catch (err) {
      setError('No pudimos determinar tu ubicación, usando CDMX como default.');
    }

    // 3. Default
    setCoords(DEFAULT_COORDS);
    setSource('default');
    setStatus('ready');
  }, []);

  useEffect(() => {
    resolve();
  }, [resolve]);

  return { status, coords, source, error, refresh: resolve };
}
