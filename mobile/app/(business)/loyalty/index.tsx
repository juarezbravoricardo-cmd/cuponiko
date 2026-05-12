/**
 * Business · Lista de tarjetas de lealtad propias.
 *
 * Funciones:
 *  - Lista con nombre, sellos requeridos, consumidores enrolados, status.
 *  - Botón "Crear tarjeta" → /(business)/loyalty/new
 *  - CTA "Escanear QR de lealtad" → /(business)/loyalty/scanner
 *
 * Defensivo: si el endpoint LYL-BIZ-01 no está montado, mostramos empty state
 * con guidance en lugar de crash.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import {
  fetchBusinessLoyaltyCards,
  type BusinessLoyaltyCard,
} from '@/services/loyaltyApi';
import { extractApiError } from '@/services/api';
import { colors, fontSize, radii, spacing } from '@/utils/theme';

export default function BusinessLoyaltyList() {
  const router = useRouter();
  const [cards, setCards] = useState<BusinessLoyaltyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await fetchBusinessLoyaltyCards();
      setCards(list);
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
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Tarjetas de lealtad</Text>
          <Text style={styles.subtitle}>
            Convierte clientes ocasionales en clientes frecuentes con sellos canjeables por una recompensa.
          </Text>
        </View>
      </View>

      <View style={styles.actionsRow}>
        <View style={{ flex: 1 }}>
          <Button
            title="Escanear QR"
            variant="primary"
            onPress={() => router.push('/(business)/loyalty/scanner')}
          />
        </View>
        <View style={{ width: spacing.md }} />
        <View style={{ flex: 1 }}>
          <Button
            title="Crear tarjeta"
            variant="secondary"
            onPress={() => router.push('/(business)/loyalty/new')}
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(c) => String(c.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
          }
          renderItem={({ item }) => <CardRow card={item} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Sin tarjetas activas</Text>
              <Text style={styles.emptyText}>
                Crea tu primera tarjeta de lealtad para empezar a fidelizar clientes.
              </Text>
              {!!error && <Text style={styles.errorText}>{error}</Text>}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function CardRow({ card }: { card: BusinessLoyaltyCard }) {
  const stroke = card.is_active ? card.design_color || colors.primary : colors.border;
  return (
    <Pressable style={[styles.row, { borderColor: stroke }]}>
      <View style={styles.rowTop}>
        <View
          style={[
            styles.iconChip,
            { backgroundColor: card.design_color || colors.primary },
          ]}
        >
          <Text style={styles.iconChipText}>{(card.icon || '⭐').slice(0, 2)}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{card.name}</Text>
          <Text style={styles.rowReward} numberOfLines={1}>{card.reward_description}</Text>
        </View>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: card.is_active ? colors.success : colors.textMuted },
          ]}
        >
          <Text style={styles.statusBadgeText}>{card.is_active ? 'Activa' : 'Inactiva'}</Text>
        </View>
      </View>
      <View style={styles.rowMetrics}>
        <Metric label="Sellos requeridos" value={String(card.stamps_required)} />
        <Metric label="Inscritos" value={String(card.consumers_enrolled)} />
      </View>
    </Pressable>
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
  header: { padding: spacing.lg, gap: spacing.xs, flexDirection: 'row' },
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  subtitle: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.xs },
  actionsRow: { flexDirection: 'row', paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  empty: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  emptyText: { color: colors.textMuted, textAlign: 'center' },
  errorText: { color: colors.danger, marginTop: spacing.md, textAlign: 'center' },
  row: {
    backgroundColor: colors.bgLight,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 2,
    gap: spacing.sm,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  iconChip: {
    width: 44, height: 44, borderRadius: radii.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  iconChipText: { color: '#FFFFFF', fontSize: fontSize.lg, fontWeight: '800' },
  rowTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  rowReward: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },
  statusBadge: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radii.pill },
  statusBadgeText: { color: '#FFFFFF', fontSize: fontSize.xs, fontWeight: '700' },
  rowMetrics: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs },
  metric: { flex: 1 },
  metricValue: { fontSize: fontSize.lg, fontWeight: '800', color: colors.textPrimary },
  metricLabel: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
});
