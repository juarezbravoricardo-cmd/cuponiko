import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { Button } from '@/components/Button';
import { api, extractApiError } from '@/services/api';
import { colors, spacing, fontSize } from '@/utils/theme';

export default function RegisterBusiness() {
  const router = useRouter();
  const [form, setForm] = useState({
    full_name: '',
    business_name: '',
    category: '',
    address_input: '',
    phone: '+52',
    email: '',
    password: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onChange = (k: keyof typeof form) => (v: string) => setForm({ ...form, [k]: v });

  const onSubmit = async () => {
    setErr(null);
    setLoading(true);
    try {
      const r = await api.post('/api/auth/register/business', {
        full_name: form.full_name.trim(),
        business_name: form.business_name.trim(),
        category: form.category.trim(),
        address_input: form.address_input.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      const userId = r.data.data?.user_id;
      router.replace({
        pathname: '/(auth)/verify-business',
        params: { email: form.email.trim(), user_id: String(userId) },
      });
    } catch (e) {
      setErr(extractApiError(e).error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer>
      <Text style={styles.title}>Registrar mi negocio</Text>
      <Text style={styles.sub}>
        Validaremos tu dirección y te pediremos verificar correo y teléfono.
      </Text>
      <TextField label="Tu nombre" value={form.full_name} onChangeText={onChange('full_name')} />
      <TextField
        label="Nombre del negocio"
        value={form.business_name}
        onChangeText={onChange('business_name')}
      />
      <TextField label="Categoría" value={form.category} onChangeText={onChange('category')} />
      <TextField
        label="Dirección completa"
        value={form.address_input}
        onChangeText={onChange('address_input')}
      />
      <TextField
        label="Teléfono (+52...)"
        keyboardType="phone-pad"
        value={form.phone}
        onChangeText={onChange('phone')}
      />
      <TextField
        label="Correo"
        autoCapitalize="none"
        keyboardType="email-address"
        value={form.email}
        onChangeText={onChange('email')}
      />
      <TextField
        label="Contraseña"
        secureTextEntry
        value={form.password}
        onChangeText={onChange('password')}
      />
      {!!err && <Text style={styles.error}>{err}</Text>}
      <Button title="Registrar negocio" onPress={onSubmit} loading={loading} />
      <Button title="Cancelar" variant="ghost" onPress={() => router.back()} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  sub: { color: colors.textMuted, marginBottom: spacing.md },
  error: { color: colors.danger, marginVertical: spacing.sm, textAlign: 'center' },
});
