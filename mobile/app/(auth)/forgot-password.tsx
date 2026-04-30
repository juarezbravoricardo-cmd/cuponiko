import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { Button } from '@/components/Button';
import { api, extractApiError } from '@/services/api';
import { colors, spacing, fontSize } from '@/utils/theme';

export default function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setLoading(true);
    try {
      await api.post('/api/auth/forgot-password', { email: email.trim() });
    } catch (_e) {
      // AUTH-09 siempre responde 200; si llegara a fallar el transport, tratamos igual.
    } finally {
      setLoading(false);
      setSent(true);
    }
  };

  if (sent) {
    return (
      <ScreenContainer>
        <Text style={styles.title}>Revisa tu correo</Text>
        <Text style={styles.sub}>
          Si el correo está registrado, recibirás instrucciones para restablecer tu contraseña.
        </Text>
        <Button title="Volver a iniciar sesión" onPress={() => router.replace('/(auth)/login')} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Text style={styles.title}>Recuperar contraseña</Text>
      <Text style={styles.sub}>Ingresa tu correo y te enviaremos un enlace.</Text>
      <TextField
        label="Correo"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Button title="Enviar enlace" onPress={onSubmit} loading={loading} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  sub: { color: colors.textMuted, marginBottom: spacing.md },
});
