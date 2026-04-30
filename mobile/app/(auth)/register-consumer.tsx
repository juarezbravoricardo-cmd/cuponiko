import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { Button } from '@/components/Button';
import { api, extractApiError } from '@/services/api';
import { colors, spacing, fontSize } from '@/utils/theme';

export default function RegisterConsumer() {
  const router = useRouter();
  const [form, setForm] = useState({ full_name: '', email: '', password: '' });
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onChange = (k: keyof typeof form) => (v: string) => setForm({ ...form, [k]: v });

  const onSubmit = async () => {
    setErr(null);
    setLoading(true);
    try {
      await api.post('/api/auth/register', {
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      router.replace({
        pathname: '/(auth)/verify-email',
        params: { email: form.email.trim() },
      });
    } catch (e) {
      const er = extractApiError(e);
      setErr(er.error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer>
      <Text style={styles.title}>Crear cuenta</Text>
      <Text style={styles.sub}>Te enviaremos un código de 6 dígitos para verificar.</Text>
      <TextField label="Nombre completo" value={form.full_name} onChangeText={onChange('full_name')} />
      <TextField
        label="Correo"
        autoCapitalize="none"
        keyboardType="email-address"
        value={form.email}
        onChangeText={onChange('email')}
      />
      <TextField
        label="Contraseña (mín. 8 caracteres y un número)"
        secureTextEntry
        value={form.password}
        onChangeText={onChange('password')}
      />
      {!!err && <Text style={styles.error}>{err}</Text>}
      <Button title="Crear cuenta" onPress={onSubmit} loading={loading} />
      <View style={{ height: spacing.md }} />
      <Button title="Ya tengo cuenta — iniciar sesión" variant="ghost" onPress={() => router.back()} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  sub: { color: colors.textMuted, marginBottom: spacing.md },
  error: { color: colors.danger, marginVertical: spacing.sm, textAlign: 'center' },
});
