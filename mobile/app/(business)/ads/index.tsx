/**
 * Business · Lista de anuncios.
 *
 * Funciones:
 *  - Lista con status badge (active / paused / expired) + métricas
 *    (impressions, clicks, redemptions).
 *  - Botón "Crear anuncio" navega a /(business)/ads/new.
 *
 * Defensivo: si el backend aún no expone GET /api/ads/my-ads, mostramos empty
 * state guiando al usuario a crear su primer anuncio.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { fetchMyAds, type MyAd } from '@/services/adsApi';
import { extractApiError } from '@/services/api';
import { colors, fontSize, radii, spacing } from '@/utils/theme';
import { formatShortDate } from '@/utils/format';

const STATUS_COLOR: Record<MyAd['status'], string> = {
  active: colors.success,
  paused: colors.warning,
  expired: colors.textMuted,
};

const STATUS_LABEL: Record<MyAd['status'], string> = {
  active: 'Activo',
  paused: 'Pausado',
  expired: 'Vencido',
};

export default function BusinessAdsList() {
  const router = useRouter();
  const [ads, setAds] = useState<MyAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await fetchMyAds();
      setAds(list);
    } catch (e) {
      setError(extractApiError(e).error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Mis anuncios</Text>
        <Text style={styles.subtitle}>
          Promociones pagadas que aparecen destacadas en el mapa de los consumidores cercanos.
        </Text>
      </View>

      <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.md }}>
        <Button
          title="Crear anuncio"
          variant="primary"
          onPress={() => router.push('/(business)/ads/new')}
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={ads}
          keyExtractor={(a) => String(a.ad_id)}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
          }
          renderItem={({ item }) => <AdRow ad={item} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Aún no tienes anuncios</Text>
              <Text style={styles.emptyText}>
                Los anuncios destacan tu negocio en el mapa y aumentan el alcance fuera de tu zona habitual.
              </Text>
              {!!error && <Text style={styles.errorText}>{error}</Text>}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function AdRow({ ad }: { ad: MyAd }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={styles.rowTitle} numberOfLines={2}>{ad.title}</Text>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[ad.status] }]}>
          <Text style={styles.statusBadgeText}>{STATUS_LABEL[ad.status]}</Text>
        </View>
      </View>
      <Text style={styles.rowDates}>
        {formatShortDate(ad.start_date)} — {formatShortDate(ad.end_date)}
      </Text>
      <View style={styles.metricsRow}>
        <Metric label="Impresiones" value={String(ad.impressions)} />
        <Metric label="Clics" value={String(ad.clicks)} />
        <Metric label="Canjes" value={String(ad.redemptions)} />
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgMuted },
  header: { padding: spacing.lg, gap: spacing.xs },
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  subtitle: { fontSize: fontSize.sm, color: colors.textMuted },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  empty: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  emptyText: { color: colors.textMuted, textAlign: 'center' },
  errorText: { color: colors.danger, marginTop: spacing.md, textAlign: 'center' },
  row: {
    backgroundColor: colors.bgLight, borderRadius: radii.lg,
    padding: spacing.lg, gap: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  rowTitle: { flex: 1, fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  statusBadge: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radii.pill },
  statusBadgeText: { color: '#FFFFFF', fontSize: fontSize.xs, fontWeight: '700' },
  rowDates: { color: colors.textMuted, fontSize: fontSize.xs },
  metricsRow: { flexDirection: 'row', marginTop: spacing.sm },
  metric: { flex: 1 },
  metricValue: { fontSize: fontSize.lg, fontWeight: '800', color: colors.textPrimary },
  metricLabel: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
});
