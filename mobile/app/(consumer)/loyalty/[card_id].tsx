/**
 * Consumer · Detalle de tarjeta de lealtad.
 *
 * Funciones clave:
 *  - Sellos en grid visual (círculos rellenos/vacíos).
 *  - QR personal rotativo con countdown 24h (auto-refresh si quedan <1h).
 *  - Si reward_unlocked && !reward_redeemed: botón "Canjear recompensa" con
 *    haptic feedback y muestra QR de un solo uso (short_code) tras canje.
 *
 * Reglas críticas:
 *  - QR sobre fondo blanco #FFFFFF, padding 20px (ISO 18004).
 *  - Mensajes de error LITERALES del backend.
 *  - Haptic feedback en canje.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import QRCode from 'react-native-qrcode-svg';
import { Button } from '@/components/Button';
import { useLoyalty } from '@/stores/loyaltyStore';
import { redeemReward, type RewardResponse, type ConsumerLoyaltyCard } from '@/services/loyaltyApi';
import { extractApiError } from '@/services/api';
import { colors, fontSize, radii, spacing } from '@/utils/theme';

const ONE_HOUR_MS = 60 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;

export default function ConsumerLoyaltyDetail() {
  const { card_id } = useLocalSearchParams<{ card_id: string }>();
  const cardId = Number(card_id);
  const router = useRouter();

  const { myCards, fetchCards, refreshQr, loading } = useLoyalty();
  const card = useMemo(
    () => myCards.find((c) => c.consumer_loyalty_id === cardId) ?? null,
    [myCards, cardId]
  );

  const [redeeming, setRedeeming] = useState(false);
  const [reward, setReward] = useState<RewardResponse | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Si no tenemos la card en store (deeplink directo), recargamos.
  useEffect(() => {
    if (!card) void fetchCards();
  }, [card, fetchCards]);

  // Tick del countdown (cada 30s).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-rotación del QR si queda < 1h.
  useEffect(() => {
    if (!card?.qr_token || !card?.valid_until) return;
    const t = setInterval(() => {
      if (!card.valid_until) return;
      const msLeft = new Date(card.valid_until).getTime() - Date.now();
      if (msLeft < ONE_HOUR_MS) {
        void refreshQr(card.consumer_loyalty_id);
      }
    }, FIVE_MIN_MS);
    return () => clearInterval(t);
  }, [card?.qr_token, card?.valid_until, card?.consumer_loyalty_id, refreshQr]);

  const onRedeem = useCallback(async () => {
    if (!card) return;
    setRedeeming(true);
    try {
      const r = await redeemReward(card.consumer_loyalty_id);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setReward(r);
      await fetchCards();
    } catch (e) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('No se pudo canjear', extractApiError(e).error);
    } finally {
      setRedeeming(false);
    }
  }, [card, fetchCards]);

  if (!card) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const isSuspended = card.business.status === 'suspended';
  const unlocked = card.reward_unlocked && !card.reward_redeemed;
  const validUntilMs = card.valid_until ? new Date(card.valid_until).getTime() : 0;
  const msLeft = Math.max(0, validUntilMs - now);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => fetchCards()} tintColor={colors.primary} />
        }
      >
        <Text style={styles.business}>{card.business.business_name}</Text>
        <Text style={styles.cardName}>{card.loyalty_card.name}</Text>
        <Text style={styles.reward}>{card.loyalty_card.reward_description}</Text>

        {isSuspended && (
          <View style={styles.bannerDanger}>
            <Text style={styles.bannerText}>Negocio temporalmente no disponible.</Text>
          </View>
        )}

        <StampGrid card={card} />
        <Text style={styles.counter}>
          {card.stamps_count} / {card.stamps_required} sellos
        </Text>

        {unlocked && !isSuspended && !reward && (
          <View style={{ marginTop: spacing.lg }}>
            <Button
              title="Canjear recompensa"
              variant="secondary"
              onPress={onRedeem}
              loading={redeeming}
            />
          </View>
        )}

        {reward && (
          <View style={styles.rewardBox}>
            <Text style={styles.rewardTitle}>¡Recompensa lista!</Text>
            <Text style={styles.rewardCaption}>
              Muestra este código al negocio. Caduca el {new Date(reward.expires_at).toLocaleString()}.
            </Text>
            <View style={styles.qrWrap}>
              <QRCode value={reward.jwt} size={200} backgroundColor="#FFFFFF" />
            </View>
            <Text style={styles.shortCode}>{reward.short_code}</Text>
          </View>
        )}

        {!reward && card.qr_token && !isSuspended && (
          <View style={styles.qrSection}>
            <Text style={styles.qrSectionTitle}>Tu QR para acumular sellos</Text>
            <View style={styles.qrWrap}>
              <QRCode value={card.qr_token} size={220} backgroundColor="#FFFFFF" />
            </View>
            <Text style={styles.qrCaption}>
              Muéstralo al negocio en cada visita para acumular un sello.
            </Text>
            <Text style={styles.qrExpiry}>
              {msLeft > 0
                ? `Vence en ${formatDuration(msLeft)}`
                : 'QR vencido — refrescando…'}
            </Text>
          </View>
        )}

        <View style={{ height: spacing.xl }} />
        <Button title="Volver" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

function StampGrid({ card }: { card: ConsumerLoyaltyCard }) {
  const stamps = useMemo(
    () => Array.from({ length: card.stamps_required }, (_, i) => i < card.stamps_count),
    [card.stamps_count, card.stamps_required]
  );
  const fillColor = card.loyalty_card.design_color || colors.primary;
  return (
    <View style={styles.stampGrid}>
      {stamps.map((filled, i) => (
        <View
          key={i}
          style={[
            styles.stamp,
            {
              backgroundColor: filled ? fillColor : colors.bgMuted,
              borderColor: filled ? fillColor : colors.border,
            },
          ]}
        >
          {filled && <Text style={styles.stampText}>✓</Text>}
        </View>
      ))}
    </View>
  );
}

function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgMuted },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.sm },
  business: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: '600' },
  cardName: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  reward: { fontSize: fontSize.md, color: colors.textPrimary, marginVertical: spacing.sm },
  bannerDanger: {
    backgroundColor: colors.danger,
    padding: spacing.md,
    borderRadius: radii.md,
    marginVertical: spacing.sm,
  },
  bannerText: { color: '#FFFFFF', fontWeight: '700', textAlign: 'center' },
  stampGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  stamp: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stampText: { color: '#FFFFFF', fontWeight: '800' },
  counter: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: spacing.sm, fontWeight: '600' },
  qrSection: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    backgroundColor: colors.bgLight,
    borderRadius: radii.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  qrSectionTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  qrWrap: { padding: 20, backgroundColor: '#FFFFFF', borderRadius: radii.md, marginVertical: spacing.md },
  qrCaption: { color: colors.textMuted, textAlign: 'center', fontSize: fontSize.sm },
  qrExpiry: { color: colors.textMuted, fontSize: fontSize.xs },
  rewardBox: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.bgLight,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.success,
    alignItems: 'center',
  },
  rewardTitle: { color: colors.success, fontSize: fontSize.lg, fontWeight: '800' },
  rewardCaption: { color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs, fontSize: fontSize.sm },
  shortCode: {
    marginTop: spacing.sm,
    fontSize: fontSize.xl,
    fontWeight: '800',
    letterSpacing: 4,
    color: colors.textPrimary,
  },
});
