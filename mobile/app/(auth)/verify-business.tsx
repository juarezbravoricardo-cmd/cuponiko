import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { Button } from '@/components/Button';
import { api, extractApiError } from '@/services/api';
import { colors, spacing, fontSize } from '@/utils/theme';

export default function VerifyBusiness() {
  const { email, user_id } = useLocalSearchParams<{ email: string; user_id: string }>();
  const router = useRouter();
  const [emailCode, setEmailCode] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [emailDone, setEmailDone] = useState(false);
  const [phoneDone, setPhoneDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const verifyEmail = async () => {
    setErr(null);
    setLoading(true);
    try {
      await api.post('/api/auth/verify-email', { email, code: emailCode });
      setEmailDone(true);
    } catch (e) {
      setErr(extractApiError(e).error);
    } finally {
      setLoading(false);
    }
  };

  const verifyPhone = async () => {
    setErr(null);
    setLoading(true);
    try {
      await api.post('/api/auth/verify-phone', { user_id: Number(user_id), code: phoneCode });
      setPhoneDone(true);
    } catch (e) {
      setErr(extractApiError(e).error);
    } finally {
      setLoading(false);
    }
  };

  const finishFlow = () => router.replace('/(auth)/login');

  return (
    <ScreenContainer>
      <Text style={styles.title}>Verifica tu negocio</Text>
      <Text style={styles.sub}>Necesitamos confirmar tu correo y tu teléfono.</Text>

      <View style={styles.block}>
        <Text style={styles.label}>1. Código por email {emailDone ? '✓' : ''}</Text>
        {!emailDone && (
          <>
            <TextField
              label={`Código enviado a ${email}`}
              keyboardType="number-pad"
              maxLength={6}
              value={emailCode}
              onChangeText={setEmailCode}
            />
            <Button title="Verificar correo" onPress={verifyEmail} loading={loading} />
          </>
        )}
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>2. Código por SMS {phoneDone ? '✓' : ''}</Text>
        {!phoneDone && (
          <>
            <TextField
              label="Código recibido por SMS"
              keyboardType="number-pad"
              maxLength={6}
              value={phoneCode}
              onChangeText={setPhoneCode}
            />
            <Button title="Verificar teléfono" onPress={verifyPhone} loading={loading} />
          </>
        )}
      </View>

      {!!err && <Text style={styles.error}>{err}</Text>}

      {emailDone && phoneDone && (
        <Button title="Ir a iniciar sesión" variant="primary" onPress={finishFlow} />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  sub: { color: colors.textMuted, marginBottom: spacing.md },
  label: { fontSize: fontSize.md, fontWeight: '700', marginBottom: spacing.sm },
  block: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  error: { color: colors.danger, marginVertical: spacing.sm, textAlign: 'center' },
});
