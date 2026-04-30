import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { Button } from '@/components/Button';
import { api, extractApiError } from '@/services/api';
import { colors, spacing, fontSize } from '@/utils/theme';

export default function VerifyEmail() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setErr(null);
    setLoading(true);
    try {
      await api.post('/api/auth/verify-email', { email, code });
      router.replace('/(auth)/login');
    } catch (e) {
      setErr(extractApiError(e).error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer>
      <Text style={styles.title}>Verifica tu correo</Text>
      <Text style={styles.sub}>
        Enviamos un código de 6 dígitos a {email}. Expira en 30 minutos.
      </Text>
      <TextField
        label="Código"
        keyboardType="number-pad"
        maxLength={6}
        value={code}
        onChangeText={setCode}
      />
      {!!err && <Text style={styles.error}>{err}</Text>}
      <Button title="Verificar" onPress={onSubmit} loading={loading} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  sub: { color: colors.textMuted, marginBottom: spacing.md },
  error: { color: colors.danger, marginVertical: spacing.sm, textAlign: 'center' },
});
