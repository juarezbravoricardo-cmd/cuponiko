import { useState } from 'react';
import { Linking, StyleSheet, Text } from 'react-native';
import { ScreenContainer } from '@/components/ScreenContainer';
import { Button } from '@/components/Button';
import { api, extractApiError } from '@/services/api';
import { colors, spacing, fontSize } from '@/utils/theme';

export default function BusinessUpgrade() {
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onUpgrade = async () => {
    setErr(null);
    setLoading(true);
    try {
      const r = await api.post('/api/billing/create-checkout-session', {});
      const url = r.data.data?.checkout_url;
      if (url) {
        await Linking.openURL(url);
      } else {
        setErr('No pudimos iniciar el pago. Intenta de nuevo.');
      }
    } catch (e) {
      setErr(extractApiError(e).error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer>
      <Text style={styles.title}>Plan Premium</Text>
      <Text style={styles.sub}>
        Desbloquea cupones transferibles, anuncios pagados y hasta 20 cupones activos.
      </Text>
      <Text style={styles.price}>$299 / mes</Text>
      {!!err && <Text style={styles.error}>{err}</Text>}
      <Button title="Suscribirme" variant="secondary" onPress={onUpgrade} loading={loading} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary, marginTop: spacing.lg },
  sub: { color: colors.textMuted, marginVertical: spacing.md },
  price: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.secondary,
    marginVertical: spacing.md,
  },
  error: { color: colors.danger, marginVertical: spacing.sm, textAlign: 'center' },
});
