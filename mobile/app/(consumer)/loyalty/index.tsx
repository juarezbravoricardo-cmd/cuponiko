/**
 * Consumer · Lista de tarjetas de lealtad.
 *
 * Analogía: la pestaña "tarjetas" de Wallet — un vistazo rápido a todas las
 * tarjetas de café/comida que tienes con sus barras de progreso. Tap en una
 * abre el detalle con QR rotativo y opción de canjear.
 *
 * Reglas UI honradas:
 *  - Pull-to-refresh, loading skeleton, empty state descriptivo.
 *  - Badge morado (secondary) si reward_unlocked.
 *  - Nunca naranja+morado en el mismo elemento (la barra usa naranja por
 *    default y, si está unlocked, todo el card cambia a stroke morado).
 *  - Mensajes de error LITERALES del backend.
 */

import React, { useCallback, useEffect } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useLoyalty } from '@/stores/loyaltyStore';
import { colors, fontSize, radii, spacing } from '@/utils/theme';
import type { ConsumerLoyaltyCard } from '@/services/loyaltyApi';

export default function ConsumerLoyaltyList() {
  const router = useRouter();
  const { myCards, loading, error, fetchCards } = useLoyalty();

  useEffect(() => {
    void fetchCards();
  }, [fetchCards]);

  const onRefresh = useCallback(() => {
    void fetchCards();
  }, [fetchCards]);

  const renderItem = useCallback(
    ({ item }: { item: ConsumerLoyaltyCard }) => (
      <LoyaltyCardRow
        card={item}
        onPress={() =>
          router.push({
            pathname: '/(consumer)/loyalty/[card_id]',
            params: { card_id: String(item.consumer_loyalty_id) },
          })
        }
      />
    ),
    [router]
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Mis tarjetas de lealtad</Text>
        <Text style={styles.subtitle}>
          Acumula sellos en cada visita y canjea recompensas exclusivas.
        </Text>
      </View>

      {loading && myCards.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={myCards}
          keyExtractor={(c) => String(c.consumer_loyalty_id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            !loading ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Sin tarjetas todavía</Text>
                <Text style={styles.emptyText}>
                  Cuando un negocio cercano tenga programa de lealtad, podrás unirte y aparecerá aquí.
                </Text>
                {!!error && <Text style={styles.errorText}>{error}</Text>}
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

function LoyaltyCardRow({
  card,
  onPress,
}: {
  card: ConsumerLoyaltyCard;
  onPress: () => void;
}) {
  const progress = Math.min(1, card.stamps_count / Math.max(1, card.stamps_required));
  const unlocked = card.reward_unlocked && !card.reward_redeemed;
  const stroke = unlocked ? colors.secondary : colors.border;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { borderColor: stroke },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={styles.cardTop}>
        {card.business.business_name ? (
          <View style={styles.logoFallback}>
            <Text style={styles.logoFallbackText}>
              {card.business.business_name.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        ) : (
          <View style={styles.logoFallback} />
        )}
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={styles.businessName} numberOfLines={1}>
            {card.business.business_name}
          </Text>
          <Text style={styles.cardName} numberOfLines={1}>
            {card.loyalty_card.name}
          </Text>
        </View>
        {unlocked && (
          <View style={styles.badgeUnlocked}>
            <Text style={styles.badgeText}>¡Lista!</Text>
          </View>
        )}
      </View>

      <Text style={styles.reward} numberOfLines={2}>
        {card.loyalty_card.reward_description}
      </Text>

      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${progress * 100}%`,
              backgroundColor: unlocked ? colors.secondary : colors.primary,
            },
          ]}
        />
      </View>
      <Text style={styles.counter}>
        {card.stamps_count} / {card.stamps_required} sellos
      </Text>
    </Pressable>
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
  card: {
    backgroundColor: colors.bgLight,
    borderRadius: radii.lg,
    borderWidth: 2,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  logoFallback: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.bgMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoFallbackText: { fontSize: fontSize.lg, fontWeight: '800', color: colors.textPrimary },
  businessName: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: '600' },
  cardName: { fontSize: fontSize.md, color: colors.textPrimary, fontWeight: '700' },
  badgeUnlocked: {
    backgroundColor: colors.secondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  badgeText: { color: '#FFFFFF', fontSize: fontSize.xs, fontWeight: '700' },
  reward: { color: colors.textMuted, fontSize: fontSize.sm },
  progressTrack: {
    height: 8,
    backgroundColor: colors.border,
    borderRadius: radii.pill,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  progressFill: { height: '100%', borderRadius: radii.pill },
  counter: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: '600' },
});
