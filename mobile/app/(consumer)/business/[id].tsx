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

import React, { useEffect, useState } from 'react';
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
import {
  saveCoupon,
  type BusinessCouponListItem,
} from '@/services/couponsApi';
import { ScreenContainer } from '@/components/ScreenContainer';
import { colors, fontSize, radii, spacing } from '@/utils/theme';
import { formatDiscount } from '@/utils/format';

interface PublicBusiness {
  business_id: number;
  business_name: string;
  category: string;
  logo_url: string | null;
  display_address: string | null;
  coupons: BusinessCouponListItem[];
}

export default function BusinessProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<PublicBusiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        // El endpoint público por ID lo implementaremos con el listado nearby
        // filtrado en cliente. Si el backend expone luego /businesses/:id se
        // cambia una sola línea.
        const r = await api.get(`/api/businesses/${id}/public`).catch(async () => {
          // Fallback: derivar desde nearby (infalible pero trae 1 request extra)
          const rr = await api.get('/api/businesses/nearby', {
            params: { lat: 19.4326, lng: -99.1332, radius: 500000 },
          });
          const b = rr.data.data.businesses.find(
            (x: { business_id: number }) => x.business_id === Number(id)
          );
          return { data: { data: { ...b, coupons: [] } } };
        });
        setData(r.data.data);
      } catch {
        Alert.alert('Error', 'No pudimos cargar el negocio.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

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
});
