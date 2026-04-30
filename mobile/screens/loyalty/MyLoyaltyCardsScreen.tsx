/**
 * MyLoyaltyCardsScreen — pantalla mínima Fase 3.
 * Muestra tarjetas de lealtad del consumidor con QR rotativo (24h).
 * Auto-refresca el QR si quedan menos de 60 minutos de vida.
 *
 * Reglas UI obligatorias:
 *  - QR sobre fondo blanco #FFFFFF, padding 20px (ISO 18004).
 *  - Color primario #F97316 (naranja) para CTAs / sellos llenos.
 *  - Estado reward_unlocked: banner verde #16A34A "¡Recompensa lista!".
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {
  fetchMyLoyaltyCards,
  refreshLoyaltyQr,
  redeemReward,
  ConsumerLoyaltyCard,
} from '../../services/loyaltyApi';
import { extractApiError } from '../../services/api';

const PRIMARY = '#F97316';
const SUCCESS = '#16A34A';
const SUSPENDED = '#DC2626';
const TEXT_DARK = '#1F1F1F';
const TEXT_MUTED = '#6B7280';
const BG_LIGHT = '#F5F5F5';
const ONE_HOUR_MS = 60 * 60 * 1000;

export default function MyLoyaltyCardsScreen() {
  const [cards, setCards] = useState<ConsumerLoyaltyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchMyLoyaltyCards();
      setCards(list);
    } catch (e) {
      const err = extractApiError(e);
      Alert.alert('Error', err.error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-rotación: si algún QR vence en < 1h, refrescarlo.
  useEffect(() => {
    const timer = setInterval(async () => {
      const now = Date.now();
      const stale = cards.filter(
        (c) => c.qr_token && c.valid_until && new Date(c.valid_until).getTime() - now < ONE_HOUR_MS
      );
      if (stale.length === 0) return;
      try {
        await Promise.all(stale.map((c) => refreshLoyaltyQr(c.consumer_loyalty_id)));
        load();
      } catch (e) { /* silent */ }
    }, 5 * 60 * 1000); // cada 5 min
    return () => clearInterval(timer);
  }, [cards, load]);

  const onRedeem = async (card: ConsumerLoyaltyCard) => {
    try {
      const r = await redeemReward(card.consumer_loyalty_id);
      Alert.alert('¡Recompensa!', `Muestra este código al negocio: ${r.short_code}`);
      load();
    } catch (e) {
      const err = extractApiError(e);
      Alert.alert('No se pudo canjear', err.error);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <Text style={styles.title}>Mis tarjetas de lealtad</Text>
      {cards.length === 0 && (
        <Text style={styles.muted}>Aún no te has unido a ningún programa de lealtad.</Text>
      )}
      {cards.map((card) => (
        <CardView key={card.consumer_loyalty_id} card={card} onRedeem={onRedeem} />
      ))}
    </ScrollView>
  );
}

function CardView({ card, onRedeem }: { card: ConsumerLoyaltyCard; onRedeem: (c: ConsumerLoyaltyCard) => void }) {
  const stamps = useMemo(
    () => Array.from({ length: card.stamps_required }, (_, i) => i < card.stamps_count),
    [card.stamps_count, card.stamps_required]
  );
  const isSuspended = card.business.status === 'suspended';
  return (
    <View style={[styles.card, { borderColor: card.loyalty_card.design_color || PRIMARY }]}>
      <Text style={styles.business}>{card.business.business_name}</Text>
      <Text style={styles.cardName}>{card.loyalty_card.name}</Text>
      <Text style={styles.muted}>{card.loyalty_card.reward_description}</Text>

      {isSuspended && (
        <View style={[styles.banner, { backgroundColor: SUSPENDED }]}>
          <Text style={styles.bannerText}>Negocio temporalmente no disponible.</Text>
        </View>
      )}

      <View style={styles.stampsRow}>
        {stamps.map((filled, i) => (
          <View
            key={i}
            style={[
              styles.stamp,
              { backgroundColor: filled ? (card.loyalty_card.design_color || PRIMARY) : '#E5E7EB' },
            ]}
          />
        ))}
      </View>
      <Text style={styles.counter}>{card.stamps_count} / {card.stamps_required} sellos</Text>

      {card.reward_unlocked && !card.reward_redeemed && !isSuspended && (
        <TouchableOpacity onPress={() => onRedeem(card)} style={[styles.cta, { backgroundColor: SUCCESS }]}>
          <Text style={styles.ctaText}>Canjear recompensa</Text>
        </TouchableOpacity>
      )}

      {!card.reward_redeemed && card.qr_token && !isSuspended && (
        <View style={styles.qrBox}>
          <QRCode value={card.qr_token} size={180} backgroundColor="#FFFFFF" />
          <Text style={styles.qrCaption}>Muéstralo al negocio para acumular sello.</Text>
          <Text style={styles.qrExpiry}>Vence: {new Date(card.valid_until || '').toLocaleString()}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG_LIGHT },
  center: { justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: TEXT_DARK, marginBottom: 12 },
  muted: { color: TEXT_MUTED, marginVertical: 6 },
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 16,
    borderWidth: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  business: { fontSize: 13, color: TEXT_MUTED, fontWeight: '600' },
  cardName: { fontSize: 18, fontWeight: '700', color: TEXT_DARK, marginVertical: 4 },
  banner: { padding: 8, borderRadius: 8, marginVertical: 6 },
  bannerText: { color: '#FFF', fontWeight: '600' },
  stampsRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  stamp: { width: 24, height: 24, borderRadius: 12, margin: 4 },
  counter: { marginTop: 6, color: TEXT_MUTED, fontSize: 13 },
  cta: { padding: 12, borderRadius: 12, marginTop: 12, alignItems: 'center' },
  ctaText: { color: '#FFF', fontWeight: '700', fontSize: 16 },
  qrBox: {
    marginTop: 16, alignItems: 'center', padding: 20, backgroundColor: '#FFFFFF', borderRadius: 12,
  },
  qrCaption: { marginTop: 8, color: TEXT_DARK, fontSize: 14, textAlign: 'center' },
  qrExpiry: { marginTop: 4, color: TEXT_MUTED, fontSize: 12 },
});
