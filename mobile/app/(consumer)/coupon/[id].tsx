/**
 * Detalle de cupón antes de guardarlo. Pantalla ligera: reutiliza el save
 * y el detalle viene del perfil del negocio (navegación natural).
 *
 * Analogía: ficha técnica. Ves letras chiquitas (condiciones, límites),
 * decides y tocas Guardar. El botón Guardar es lo único que llama al
 * endpoint CPN-05.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/services/api';
import { saveCoupon, type BusinessCouponListItem } from '@/services/couponsApi';
import { ScreenContainer } from '@/components/ScreenContainer';
import { colors, fontSize, radii, spacing } from '@/utils/theme';
import { formatDiscount, formatShortDate } from '@/utils/format';

export default function CouponDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [coupon, setCoupon] = useState<BusinessCouponListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const r = await api.get(`/api/coupons/${id}/public`);
        setCoupon(r.data.data);
      } catch {
        Alert.alert('Error', 'No pudimos cargar el cupón.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const onSave = async () => {
    if (!coupon) return;
    setSaving(true);
    try {
      const res = await saveCoupon(coupon.coupon_id);
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
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ScreenContainer>
        <ActivityIndicator color={colors.primary} />
      </ScreenContainer>
    );
  }
  if (!coupon) {
    return (
      <ScreenContainer>
        <Text style={styles.muted}>Cupón no disponible.</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Text style={styles.title}>{coupon.title}</Text>
      <Text style={styles.discount}>{formatDiscount(coupon)}</Text>
      {coupon.description ? <Text style={styles.desc}>{coupon.description}</Text> : null}

      <View style={styles.metaBlock}>
        <Row label="Vigencia" value={`${formatShortDate(coupon.start_date)} - ${formatShortDate(coupon.end_date)}`} />
        <Row label="Usos por persona" value={String(coupon.usage_limit_per_user)} />
        <Row
          label="Disponibles"
          value={`${coupon.total_usage_limit - coupon.uses_count} de ${coupon.total_usage_limit}`}
        />
        <Row label="Acumulable" value={coupon.accumulable ? 'Sí' : 'No'} />
        {coupon.transferable ? <Row label="Transferible" value="Sí" /> : null}
        {coupon.single_use ? <Row label="Uso único" value="Sí" /> : null}
      </View>

      <Pressable
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        disabled={saving}
        onPress={onSave}
      >
        <Text style={styles.saveBtnTxt}>{saving ? 'Guardando…' : 'Guardar cupón'}</Text>
      </Pressable>
    </ScreenContainer>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.textPrimary },
  discount: { fontSize: fontSize.lg, color: colors.primary, fontWeight: '800' },
  desc: { color: colors.textMuted, marginBottom: spacing.sm },
  metaBlock: { gap: spacing.xs, marginVertical: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { color: colors.textMuted },
  rowValue: { color: colors.textPrimary, fontWeight: '600' },
  saveBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnTxt: { color: '#FFF', fontWeight: '800', fontSize: fontSize.md },
  muted: { color: colors.textMuted, textAlign: 'center' },
});
