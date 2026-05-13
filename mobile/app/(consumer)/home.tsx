/**
 * Home del consumidor (HOME-01/03).
 *
 * Analogía: vitrina del centro comercial. Al entrar ves un mapa con las
 * tiendas cercanas y un panel lateral con promociones destacadas. Tocas un
 * negocio o un anuncio y te llevan a la caja.
 *
 * Capas visuales (de arriba a abajo):
 *   1. Banner de ubicación (indica fuente GPS/IP/default y permite reintentar).
 *   2. Carrusel de anuncios activos (HOME-03).
 *   3. Mapa con pins de negocios cercanos (HOME-01).
 *   4. Lista scrolleable de negocios (ordenados por distancia).
 *
 * Nota de robustez (AP-19 está en el backend, aquí solo consumimos 50 max).
 * Nota de diseño (BP-12): si `source !== 'gps'` mostramos CTA para pedir
 * permisos de nuevo.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useGeoLocation } from '@/hooks/useGeoLocation';
import {
  fetchActiveAds,
  fetchNearby,
  registerAdClick,
  type Ad,
  type NearbyBusiness,
} from '@/services/couponsApi';
import { useAuth } from '@/stores/authStore';
import { colors, fontSize, radii, spacing } from '@/utils/theme';
import { Button } from '@/components/Button';

const DEFAULT_RADIUS = 5000;

export default function ConsumerHome() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { status: geoStatus, coords, source, refresh } = useGeoLocation();

  const [businesses, setBusinesses] = useState<NearbyBusiness[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!coords) return;
    setLoading(true);
    setError(null);
    try {
      const [b, a] = await Promise.all([
        fetchNearby({ lat: coords.lat, lng: coords.lng, radius: DEFAULT_RADIUS }),
        fetchActiveAds().catch(() => [] as Ad[]),
      ]);
      setBusinesses(b);
      setAds(a);
    } catch (e) {
      setError('No pudimos cargar los negocios. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [coords]);

  useEffect(() => {
    load();
  }, [load]);

  const initialRegion = useMemo(() => {
    if (!coords) return undefined;
    return {
      latitude: coords.lat,
      longitude: coords.lng,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    };
  }, [coords]);

  const onAdPress = async (ad: Ad) => {
    try {
      await registerAdClick(ad.ad_id);
    } catch {
      // silencioso: un click perdido no bloquea UX
    }
    router.push({ pathname: '/(consumer)/coupon/[id]', params: { id: String(ad.coupon.coupon_id) } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.hello}>Hola, {user?.full_name?.split(' ')[0] || 'amigo'}</Text>
          <Text style={styles.sourceHint}>{sourceLabel(source)}</Text>
        </View>
        <Pressable onPress={() => router.push('/(consumer)/wallet')} style={styles.walletChip}>
          <Text style={styles.walletChipTxt}>Mi cartera</Text>
        </Pressable>
        <Pressable onPress={logout} style={styles.ghostChip}>
          <Text style={styles.ghostChipTxt}>Salir</Text>
        </Pressable>
      </View>

      {geoStatus === 'loading' || !coords ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>Buscando tu ubicación…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {source !== 'gps' && (
            <View style={styles.banner}>
              <Text style={styles.bannerTxt}>
                Ubicación aproximada. Activa el GPS para ver cupones más cercanos.
              </Text>
              <Button title="Activar GPS" variant="ghost" onPress={refresh} />
            </View>
          )}

          {ads.length > 0 && (
            <View>
              <Text style={styles.sectionTitle}>Promociones destacadas</Text>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={ads}
                keyExtractor={(x) => String(x.ad_id)}
                contentContainerStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
                renderItem={({ item }) => (
                  <Pressable onPress={() => onAdPress(item)} style={styles.adCard}>
                    {item.image_url ? (
                      <Image source={{ uri: item.image_url }} style={styles.adImg} />
                    ) : (
                      <View style={[styles.adImg, styles.adPlaceholder]}>
                        <Text style={styles.adPlaceholderTxt}>{item.business.business_name}</Text>
                      </View>
                    )}
                    <Text style={styles.adTitle} numberOfLines={1}>
                      {item.coupon.title}
                    </Text>
                    <Text style={styles.adSub} numberOfLines={1}>
                      {item.business.business_name}
                    </Text>
                  </Pressable>
                )}
              />
            </View>
          )}

          <View style={styles.mapWrap}>
            {Platform.OS !== 'web' ? (
              <MapView provider={PROVIDER_GOOGLE} style={styles.map} initialRegion={initialRegion}>
                {businesses.map((b) => (
                  <Marker
                    key={b.business_id}
                    coordinate={{ latitude: b.lat, longitude: b.lng }}
                    title={b.business_name}
                    description={`${Math.round(b.distance_m)} m`}
                    onCalloutPress={() =>
                      router.push({
                        pathname: '/(consumer)/business/[id]',
                        params: { id: String(b.business_id) },
                      })
                    }
                  />
                ))}
              </MapView>
            ) : (
              <View style={[styles.map, styles.webMapFallback]}>
                <Text style={styles.muted}>El mapa solo está disponible en iOS/Android.</Text>
              </View>
            )}
          </View>

          <Text style={styles.sectionTitle}>Cerca de ti</Text>
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : error ? (
            <View style={styles.banner}>
              <Text style={styles.bannerTxt}>{error}</Text>
              <Button title="Reintentar" variant="ghost" onPress={load} />
            </View>
          ) : businesses.length === 0 ? (
            <Text style={styles.muted}>
              Aún no hay negocios con cupones activos cerca de ti. Regresa pronto.
            </Text>
          ) : (
            <View style={{ gap: spacing.md }}>
              {businesses.map((b) => (
                <Pressable
                  key={b.business_id}
                  style={styles.card}
                  onPress={() =>
                    router.push({
                      pathname: '/(consumer)/business/[id]',
                      params: { id: String(b.business_id) },
                    })
                  }
                >
                  {b.logo_url ? (
                    <Image source={{ uri: b.logo_url }} style={styles.logo} />
                  ) : (
                    <View style={[styles.logo, styles.logoPh]}>
                      <Text style={styles.logoPhTxt}>
                        {b.business_name.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {b.business_name}
                    </Text>
                    <Text style={styles.cardSub} numberOfLines={1}>
                      {b.category} · {formatDistance(b.distance_m)}
                    </Text>
                    <Text style={styles.cardCount}>
                      {b.active_coupons_count} cupones activos
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function sourceLabel(src: string) {
  switch (src) {
    case 'gps':
      return 'Ubicación precisa';
    case 'last_known':
      return 'Última ubicación conocida';
    case 'ip':
      return 'Ubicación aproximada (IP)';
    default:
      return 'Mostrando CDMX por defecto';
  }
}
function formatDistance(m: number) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgLight },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  hello: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  sourceHint: { fontSize: fontSize.xs, color: colors.textMuted },
  walletChip: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  walletChipTxt: { color: '#FFF', fontWeight: '700' },
  ghostChip: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  ghostChipTxt: { color: colors.textPrimary },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.sm },
  scroll: { padding: spacing.lg, gap: spacing.lg },
  banner: {
    backgroundColor: colors.bgMuted,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  bannerTxt: { color: colors.textPrimary },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    color: colors.textPrimary,
    paddingHorizontal: spacing.xs,
  },
  adCard: { width: 220, gap: spacing.xs },
  adImg: { width: 220, height: 110, borderRadius: radii.md, backgroundColor: colors.bgMuted },
  adPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  adPlaceholderTxt: { color: colors.textMuted, fontWeight: '700', textAlign: 'center', padding: spacing.sm },
  adTitle: { fontWeight: '800', color: colors.textPrimary },
  adSub: { color: colors.textMuted, fontSize: fontSize.xs },
  mapWrap: { height: 220, borderRadius: radii.lg, overflow: 'hidden' },
  map: { flex: 1 },
  webMapFallback: {
    backgroundColor: colors.bgMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.bgLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    alignItems: 'center',
  },
  logo: { width: 52, height: 52, borderRadius: radii.md, backgroundColor: colors.bgMuted },
  logoPh: { alignItems: 'center', justifyContent: 'center' },
  logoPhTxt: { color: colors.textMuted, fontWeight: '800', fontSize: fontSize.xl },
  cardTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.textPrimary },
  cardSub: { color: colors.textMuted, fontSize: fontSize.sm },
  cardCount: { color: colors.primary, fontSize: fontSize.sm, fontWeight: '700' },
  muted: { color: colors.textMuted, textAlign: 'center' },
});
