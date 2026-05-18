/**
 * Perfil público de un negocio para el consumidor.
 *
 * Analogía: la ficha de un comercio en una guía. Ves el nombre, categoría,
 * dirección y todos sus cupones activos con un botón "Guardar" en cada uno.
 *
 * Fuente de datos: reutilizamos HOME-01 (filtrando por id en el cliente)
 * porque el contrato de Fase 2 no especifica GET /api/businesses/:id.
 * Es eficiente en costo porque ya cacheamos el listado en home.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/services/api';
import { saveCoupon } from '@/services/couponsApi';
import type { CouponStatus, DiscountType } from '@/services/couponsApi';
import { joinLoyalty } from '@/services/loyaltyApi';
import { useGeoLocation } from '@/hooks/useGeoLocation';
import { ScreenContainer } from '@/components/ScreenContainer';
import { colors, fontSize, radii, spacing } from '@/utils/theme';
import { formatDiscount } from '@/utils/format';

/**
 * Cupón público de un negocio (BIZ-01).
 * Diferente a BusinessCouponListItem porque NO expone uses_count;
 * solo remaining_uses (regla de seguridad del spec).
 */
interface PublicBusinessCoupon {
  coupon_id: number;
  title: string;
  description: string | null;
  discount_type: DiscountType;
  discount_value: number;
  precio_referencia: number | null;
  start_date: string;
  end_date: string;
  usage_limit_per_user: number;
  total_usage_limit: number;
  remaining_uses: number;
  transferable: boolean;
  accumulable: boolean;
  status: CouponStatus;
}

interface PublicLoyaltyCard {
  loyalty_card_id: number;
  name: string;
  reward_description: string;
  stamps_required: number;
  design_color: string;
  icon: string;
}

interface PublicBusiness {
  id: number;
  business_name: string;
  category: string;
  logo_url: string | null;
  display_address: string | null;
  lat: number | null;
  lng: number | null;
  active_coupons_count: number;
  has_loyalty_program: boolean;
  coupons: PublicBusinessCoupon[];
  loyalty_card: PublicLoyaltyCard | null;
}

function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000; // radio de la Tierra en metros
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const LOYALTY_JOIN_RADIUS_M = 500; // metros

export default function BusinessProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<PublicBusiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const { coords: consumerCoords } = useGeoLocation();

  const isNearBusiness = useMemo(() => {
    if (!consumerCoords || !data?.lat || !data?.lng) return false;
    const dist = haversineDistance(
      consumerCoords.lat, consumerCoords.lng,
      Number(data.lat), Number(data.lng)
    );
    return dist <= LOYALTY_JOIN_RADIUS_M;
  }, [consumerCoords, data]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        // BIZ-01 (publicService.getBusinessPublic) ya retorna `coupons` con la
        // lista de cupones activos del negocio. No requerimos fallback hacia
        // /nearby porque eso forzaba coupons:[] y ocultaba cupones reales.
        const r = await api.get(`/api/businesses/${id}/public`);
        setData(r.data.data as PublicBusiness);
      } catch {
        Alert.alert('Error', 'No pudimos cargar el negocio.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const onJoinLoyalty = async (loyaltyCardId: number) => {
    setJoining(true);
    try {
      const res = await joinLoyalty(loyaltyCardId);
      setJoined(true);
      Alert.alert('¡Te uniste!', res.message, [
        { text: 'Ver mis tarjetas', onPress: () => router.push('/(consumer)/loyalty') },
        { text: 'Seguir aquí' },
      ]);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'No pudimos unirte al programa.';
      // Si el error es que ya está unido, mostrar como éxito
      if (msg.includes('ya estás') || msg.includes('already')) {
        setJoined(true);
        Alert.alert('Ya estás en este programa', 'Ve a tu pestaña de Lealtad para ver tu tarjeta.');
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setJoining(false);
    }
  };

  const onSave = async (couponId: number) => {
    setSavingId(couponId);
    try {
      const res = await saveCoupon(couponId);
      Alert.alert('Guardado', res.message);
      router.push({
        pathname: '/(consumer)/qr/[instance_id]',
        params: { instance_id: String(res.coupon_instance_id) },
      });
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'No pudimos guardar el cupón.';
      Alert.alert('Error', msg);
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <ScreenContainer>
        <ActivityIndicator color={colors.primary} />
      </ScreenContainer>
    );
  }
  if (!data) {
    return (
      <ScreenContainer>
        <Text style={styles.muted}>Negocio no encontrado.</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <View style={styles.header}>
        {data.logo_url ? (
          <Image source={{ uri: data.logo_url }} style={styles.logo} />
        ) : (
          <View style={[styles.logo, styles.logoPh]}>
            <Text style={styles.logoPhTxt}>{data.business_name.slice(0, 1)}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{data.business_name}</Text>
          <Text style={styles.sub}>{data.category}</Text>
          {data.display_address ? (
            <Text style={styles.sub}>{data.display_address}</Text>
          ) : null}
        </View>
      </View>

      <Text style={styles.section}>Cupones activos</Text>
      <FlatList
        data={data.coupons}
        keyExtractor={(x) => String(x.coupon_id)}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <Text style={styles.muted}>Este negocio no tiene cupones activos ahora mismo.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardDiscount}>{formatDiscount(item)}</Text>
            {item.description ? <Text style={styles.cardDesc}>{item.description}</Text> : null}
            <Text style={styles.cardMeta}>
              Vence el {new Date(item.end_date).toLocaleDateString('es-MX')}
            </Text>
            <Pressable
              style={[styles.saveBtn, savingId === item.coupon_id && styles.saveBtnDisabled]}
              disabled={savingId === item.coupon_id}
              onPress={() => onSave(item.coupon_id)}
            >
              <Text style={styles.saveBtnTxt}>
                {savingId === item.coupon_id ? 'Guardando…' : 'Guardar'}
              </Text>
            </Pressable>
          </View>
        )}
      />

      {data.loyalty_card && (
        <View style={styles.loyaltySection}>
          <Text style={styles.section}>Programa de lealtad</Text>
          <View style={[styles.loyaltyCard, { borderColor: data.loyalty_card.design_color }]}>
            <View style={styles.loyaltyTop}>
              <Text style={styles.loyaltyIcon}>{data.loyalty_card.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.loyaltyName}>{data.loyalty_card.name}</Text>
                <Text style={styles.loyaltyReward}>{data.loyalty_card.reward_description}</Text>
              </View>
            </View>
            <Text style={styles.loyaltyStamps}>
              {data.loyalty_card.stamps_required} sellos para tu recompensa
            </Text>
            {joined ? (
              <View style={styles.joinedBadge}>
                <Text style={styles.joinedBadgeTxt}>✅ Ya estás en este programa</Text>
              </View>
            ) : isNearBusiness ? (
              <Pressable
                style={[styles.joinBtn, joining && { opacity: 0.6 }]}
                disabled={joining}
                onPress={() => onJoinLoyalty(data.loyalty_card!.loyalty_card_id)}
              >
                <Text style={styles.joinBtnTxt}>
                  {joining ? 'Uniéndote…' : 'Unirme al programa de lealtad'}
                </Text>
              </Pressable>
            ) : (
              <View style={styles.nearbyHint}>
                <Text style={styles.nearbyHintTxt}>
                  🎁 ¡En tu próxima visita pide que activen tu tarjeta de lealtad gratis y gana: {data.loyalty_card!.reward_description}!
                </Text>
              </View>
            )}
          </View>
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  logo: { width: 72, height: 72, borderRadius: radii.md, backgroundColor: colors.bgMuted },
  logoPh: { alignItems: 'center', justifyContent: 'center' },
  logoPhTxt: { color: colors.textMuted, fontWeight: '800', fontSize: fontSize.xxl },
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  sub: { color: colors.textMuted },
  section: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.textPrimary },
  cardDiscount: { color: colors.primary, fontWeight: '800' },
  cardDesc: { color: colors.textMuted },
  cardMeta: { color: colors.textMuted, fontSize: fontSize.xs },
  saveBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnTxt: { color: '#FFF', fontWeight: '800' },
  muted: { color: colors.textMuted, textAlign: 'center' },
  loyaltySection: {
    marginTop: spacing.lg,
  },
  loyaltyCard: {
    backgroundColor: colors.bgLight,
    borderWidth: 2,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  loyaltyTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  loyaltyIcon: {
    fontSize: 36,
  },
  loyaltyName: {
    fontSize: fontSize.md,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  loyaltyReward: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  loyaltyStamps: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: '600',
  },
  joinBtn: {
    backgroundColor: colors.secondary,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  joinBtnTxt: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: fontSize.md,
  },
  joinedBadge: {
    backgroundColor: colors.bgMuted,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  joinedBadgeTxt: {
    color: colors.success,
    fontWeight: '700',
    fontSize: fontSize.sm,
  },
  nearbyHint: {
    backgroundColor: colors.bgMuted,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  nearbyHintTxt: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center',
    fontWeight: '600',
  },
});
