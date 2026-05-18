/**
 * Cartera del consumidor (CART-01).
 *
 * Analogía: un monedero virtual con dos bolsillos. En "Activos" están los
 * cupones que puede redimir ahora; en "Historial", los ya usados, expirados
 * o cuyo negocio quedó inactivo.
 *
 * El backend ya nos filtra por `tab = active|history`; aquí solo dibujamos.
 *
 * Nota UX (AP-16): archivo único, StyleSheet al final.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { fetchWallet, fetchSavings, type WalletCoupon, type ConsumerSavings } from '@/services/couponsApi';
import { colors, fontSize, radii, spacing } from '@/utils/theme';
import { formatDiscount, formatShortDate } from '@/utils/format';

type Tab = 'active' | 'history';

export default function Wallet() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('active');
  const [items, setItems] = useState<WalletCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savings, setSavings] = useState<ConsumerSavings | null>(null);

  const load = useCallback(
    async (t: Tab) => {
      setError(null);
      try {
        const r = await fetchWallet(t);
        setItems(r);
      } catch {
        setError('No pudimos cargar tu cartera.');
      }
    },
    []
  );

  useEffect(() => {
    setLoading(true);
    load(tab).finally(() => setLoading(false));
  }, [tab, load]);

  useEffect(() => {
    fetchSavings().then(setSavings).catch(() => {});
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load(tab);
    setRefreshing(false);
  };

  return (
    <ScreenContainer scroll={false}>
      <View style={styles.tabs}>
        <TabBtn label="Activos" active={tab === 'active'} onPress={() => setTab('active')} />
        <TabBtn label="Historial" active={tab === 'history'} onPress={() => setTab('history')} />
      </View>

      {savings && (savings.redemption_count > 0 || savings.loyalty_cards_completed > 0) && (
        <View style={styles.savingsBanner}>
          <Text style={styles.savingsBannerTxt}>
            💰 ${savings.total_saved.toFixed(2)} MXN ahorrado · {savings.redemption_count} {savings.redemption_count === 1 ? 'cupón' : 'cupones'} · {savings.loyalty_cards_completed} {savings.loyalty_cards_completed === 1 ? 'tarjeta' : 'tarjetas'}
          </Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : error ? (
        <Text style={styles.muted}>{error}</Text>
      ) : items.length === 0 ? (
        <Text style={styles.muted}>
          {tab === 'active'
            ? 'Aún no tienes cupones guardados.\n\nVe a Inicio, explora los negocios cerca de ti y toca "Guardar" en el cupón que te interese. Aparecerá aquí listo para usar.'
            : 'No hay cupones en tu historial todavía.'}
        </Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(x) => String(x.coupon_instance_id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          renderItem={({ item }) => {
            const canRedeem =
              tab === 'active' &&
              item.coupon_status === 'active' &&
              item.business.status === 'active';
            return (
              <Pressable
                style={[styles.card, !canRedeem && styles.cardDisabled]}
                onPress={() => {
                  if (!canRedeem) return;
                  router.push({
                    pathname: '/(consumer)/qr/[instance_id]',
                    params: { instance_id: String(item.coupon_instance_id) },
                  });
                }}
              >
                {item.business.logo_url ? (
                  <Image source={{ uri: item.business.logo_url }} style={styles.logo} />
                ) : (
                  <View style={[styles.logo, styles.logoPh]}>
                    <Text style={styles.logoPhTxt}>
                      {item.business.business_name.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {item.business.business_name} · {formatDiscount(item)}
                  </Text>
                  <Text style={styles.meta}>
                    Vence {formatShortDate(item.end_date)}
                    {item.coupon_status !== 'active'
                      ? ` · ${statusLabel(item.coupon_status)}`
                      : ''}
                    {item.business.status !== 'active' ? ' · Negocio no disponible' : ''}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            );
          }}
        />
      )}
    </ScreenContainer>
  );
}

function TabBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.tabBtn, active && styles.tabBtnActive]} onPress={onPress}>
      <Text style={[styles.tabTxt, active && styles.tabTxtActive]}>{label}</Text>
    </Pressable>
  );
}

function statusLabel(s: string) {
  switch (s) {
    case 'paused':
      return 'En pausa';
    case 'paused_by_downgrade':
      return 'Pausado por downgrade';
    case 'expired':
      return 'Expirado';
    default:
      return s;
  }
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.bgMuted,
    borderRadius: radii.pill,
    padding: spacing.xs,
    marginBottom: spacing.md,
  },
  tabBtn: { flex: 1, paddingVertical: spacing.sm, alignItems: 'center', borderRadius: radii.pill },
  tabBtnActive: { backgroundColor: colors.primary },
  tabTxt: { color: colors.textMuted, fontWeight: '700' },
  tabTxtActive: { color: '#FFF' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  cardDisabled: { opacity: 0.55 },
  logo: { width: 52, height: 52, borderRadius: radii.md, backgroundColor: colors.bgMuted },
  logoPh: { alignItems: 'center', justifyContent: 'center' },
  logoPhTxt: { color: colors.textMuted, fontWeight: '800' },
  title: { fontWeight: '800', color: colors.textPrimary, fontSize: fontSize.md },
  sub: { color: colors.textMuted },
  meta: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: spacing.xs },
  chevron: { fontSize: fontSize.xxl, color: colors.textMuted },
  muted: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
  savingsBanner: {
    backgroundColor: colors.bgMuted,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  savingsBannerTxt: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
});
