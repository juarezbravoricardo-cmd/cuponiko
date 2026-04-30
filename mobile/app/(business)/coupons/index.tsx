/**
 * Listado de cupones del negocio (CPN-02/03/04).
 *
 * Analogía: inventario en la trastienda. Cada fila es un cupón; el botón
 * derecho alterna entre "pausar" y "activar" según estado. Los que están
 * `paused_by_downgrade` sólo pueden reactivarse si queda espacio en el plan
 * (el backend lanza 403 con mensaje claro — se lo mostramos tal cual).
 *
 * Filtros: `all | active | paused | expired` (chips superiores).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { Button } from '@/components/Button';
import {
  activateCoupon,
  fetchMyCoupons,
  pauseCoupon,
  type BusinessCouponListItem,
  type CouponStatus,
} from '@/services/couponsApi';
import { colors, fontSize, radii, spacing } from '@/utils/theme';
import { formatDiscount, formatShortDate } from '@/utils/format';

type Filter = 'all' | 'active' | 'paused' | 'expired';

export default function MyCoupons() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [coupons, setCoupons] = useState<BusinessCouponListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mutating, setMutating] = useState<number | null>(null);

  const load = useCallback(async (f: Filter) => {
    try {
      const r = await fetchMyCoupons(f);
      setCoupons(r);
    } catch {
      Alert.alert('Error', 'No pudimos cargar tus cupones.');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load(filter).finally(() => setLoading(false));
  }, [filter, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load(filter);
    setRefreshing(false);
  };

  const toggle = async (c: BusinessCouponListItem) => {
    setMutating(c.coupon_id);
    try {
      if (c.status === 'active') {
        await pauseCoupon(c.coupon_id);
      } else {
        await activateCoupon(c.coupon_id);
      }
      await load(filter);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'No pudimos actualizar el cupón.';
      Alert.alert('Aviso', msg);
    } finally {
      setMutating(null);
    }
  };

  return (
    <ScreenContainer scroll={false}>
      <View style={styles.topRow}>
        <View style={styles.chips}>
          {(['all', 'active', 'paused', 'expired'] as Filter[]).map((f) => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.chip, filter === f && styles.chipActive]}
            >
              <Text style={[styles.chipTxt, filter === f && styles.chipTxtActive]}>
                {chipLabel(f)}
              </Text>
            </Pressable>
          ))}
        </View>
        <Button title="Nuevo" onPress={() => router.push('/(business)/coupons/new')} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : coupons.length === 0 ? (
        <Text style={styles.muted}>No hay cupones que coincidan con este filtro.</Text>
      ) : (
        <FlatList
          data={coupons}
          keyExtractor={(x) => String(x.coupon_id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.sub}>{formatDiscount(item)}</Text>
                <Text style={styles.meta}>
                  {formatShortDate(item.start_date)} – {formatShortDate(item.end_date)}
                </Text>
                <Text style={styles.meta}>
                  Usos: {item.uses_count} / {item.total_usage_limit}
                </Text>
                <View style={[styles.statusPill, statusStyle(item.status)]}>
                  <Text style={styles.statusTxt}>{statusLabel(item.status)}</Text>
                </View>
              </View>
              <Pressable
                style={[styles.toggleBtn, mutating === item.coupon_id && styles.toggleBtnBusy]}
                disabled={mutating === item.coupon_id}
                onPress={() => toggle(item)}
              >
                <Text style={styles.toggleTxt}>
                  {item.status === 'active' ? 'Pausar' : 'Activar'}
                </Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </ScreenContainer>
  );
}

function chipLabel(f: Filter) {
  return f === 'all'
    ? 'Todos'
    : f === 'active'
      ? 'Activos'
      : f === 'paused'
        ? 'Pausados'
        : 'Expirados';
}
function statusLabel(s: CouponStatus) {
  return s === 'active'
    ? 'Activo'
    : s === 'paused'
      ? 'Pausado'
      : s === 'paused_by_downgrade'
        ? 'Pausado por downgrade'
        : 'Expirado';
}
function statusStyle(s: CouponStatus) {
  return s === 'active'
    ? { backgroundColor: colors.success }
    : s === 'expired'
      ? { backgroundColor: colors.danger }
      : { backgroundColor: colors.warning };
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chips: { flexDirection: 'row', gap: spacing.xs, flex: 1, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { color: colors.textMuted, fontWeight: '700' },
  chipTxtActive: { color: '#FFF' },
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
  title: { fontSize: fontSize.md, fontWeight: '800', color: colors.textPrimary },
  sub: { color: colors.primary, fontWeight: '700' },
  meta: { color: colors.textMuted, fontSize: fontSize.xs },
  statusPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    marginTop: spacing.xs,
  },
  statusTxt: { color: '#FFF', fontSize: fontSize.xs, fontWeight: '700' },
  toggleBtn: {
    backgroundColor: colors.bgMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  toggleBtnBusy: { opacity: 0.6 },
  toggleTxt: { color: colors.textPrimary, fontWeight: '700' },
  muted: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
});
