import { useState } from 'react';
import { StyleSheet, Text, View, Pressable, Alert } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { Button } from '@/components/Button';
import { useAuth } from '@/stores/authStore';
import { colors, spacing, fontSize } from '@/utils/theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const { login, loading } = useAuth();
  const router = useRouter();

  const onSubmit = async () => {
    setErr(null);
    try {
      await login(email.trim(), password);
      // La redirección la hace AuthGate al actualizar user
    } catch (e: any) {
      setErr(e?.error || 'Correo o contraseña incorrectos.');
    }
  };

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.brand}>Cuponiko</Text>
        <Text style={styles.subtitle}>¡Los mejores cupones de descuentos de tus lugares favoritos y cercanos a ti!</Text>
      </View>
      <TextField
        label="Correo"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextField
        label="Contraseña"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {!!err && <Text style={styles.error}>{err}</Text>}
      <Button title="Iniciar sesión" onPress={onSubmit} loading={loading} />
      <Link href="/(auth)/forgot-password" asChild>
        <Pressable>
          <Text style={styles.link}>¿Olvidaste tu contraseña?</Text>
        </Pressable>
      </Link>
      <View style={styles.divider} />
      <Button
        title="Crear cuenta (consumidor)"
        variant="ghost"
        onPress={() => router.push('/(auth)/register-consumer')}
      />
      <Button
        title="Soy un negocio — regístrate"
        variant="secondary"
        onPress={() => router.push('/(auth)/register-business')}
      />
      <Pressable
        onPress={() => Alert.alert('Google Sign-In', 'Integración con Google OAuth en producción usa expo-auth-session.')}
      >
        <Text style={styles.link}>Continuar con Google</Text>
      </Pressable>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', marginBottom: spacing.lg, marginTop: spacing.xl },
  brand: { fontSize: fontSize.xxl, fontWeight: '800', color: colors.primary },
  subtitle: { color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center', fontSize: fontSize.sm },
  link: {
    color: colors.primary,
    textAlign: 'center',
    marginVertical: spacing.sm,
    fontWeight: '600',
  },
  error: {
    color: colors.danger,
    textAlign: 'center',
    marginVertical: spacing.sm,
  },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
});
