import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { Button } from '@/components/Button';
import { api, extractApiError } from '@/services/api';
import { colors, spacing, fontSize } from '@/utils/theme';

export default function ResetPassword() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const [newPassword, setNewPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setErr(null);
    setLoading(true);
    try {
      await api.post('/api/auth/reset-password', { token, new_password: newPassword });
      router.replace('/(auth)/login');
    } catch (e) {
      setErr(extractApiError(e).error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer>
      <Text style={styles.title}>Nueva contraseña</Text>
      <Text style={styles.sub}>Debe tener al menos 8 caracteres y un número.</Text>
      <TextField
        label="Nueva contraseña"
        secureTextEntry
        value={newPassword}
        onChangeText={setNewPassword}
      />
      {!!err && <Text style={styles.error}>{err}</Text>}
      <Button title="Guardar" onPress={onSubmit} loading={loading} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  sub: { color: colors.textMuted, marginBottom: spacing.md },
  error: { color: colors.danger, marginVertical: spacing.sm, textAlign: 'center' },
});
