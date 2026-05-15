import { useState } from 'react';
import { StyleSheet, Text, View, Modal, FlatList, Pressable, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { Button } from '@/components/Button';
import { api, extractApiError } from '@/services/api';
import { colors, spacing, fontSize } from '@/utils/theme';
import { BUSINESS_CATEGORIES } from '@/constants/categories';

const GOOGLE_API_KEY =
  (Constants.expoConfig?.extra as any)?.googleMapsApiKey || '';

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
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);

  const onChange = (k: keyof typeof form) => (v: string) =>
    setForm({ ...form, [k]: v });

  const selectedCategoryLabel = form.category || 'Selecciona una categoría';

  const onSubmit = async () => {
    setErr(null);
    if (!form.address_input) {
      setErr('Selecciona una dirección de las sugerencias.');
      return;
    }
    if (!form.category) {
      setErr('Selecciona una categoría.');
      return;
    }
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
        Validaremos tu dirección y te enviaremos un código de verificación al correo.
      </Text>

      <TextField
        label="Tu nombre"
        value={form.full_name}
        onChangeText={onChange('full_name')}
      />
      <TextField
        label="Nombre del negocio"
        value={form.business_name}
        onChangeText={onChange('business_name')}
      />

      {/* Categoría: trigger que abre el modal */}
      <Text style={styles.fieldLabel}>Categoría</Text>
      <Pressable
        style={styles.dropdownTrigger}
        onPress={() => setCategoryModalOpen(true)}
      >
        <Text
          style={[
            styles.dropdownText,
            !form.category && styles.dropdownPlaceholder,
          ]}
        >
          {selectedCategoryLabel}
        </Text>
        <Text style={styles.dropdownChevron}>▾</Text>
      </Pressable>

      {/* Dirección: Google Places Autocomplete */}
      <Text style={styles.fieldLabel}>Dirección del negocio</Text>
      <View style={styles.placesWrapper}>
        <GooglePlacesAutocomplete
          placeholder="Empieza a escribir tu dirección..."
          minLength={3}
          fetchDetails={false}
          enablePoweredByContainer={false}
          query={{
            key: GOOGLE_API_KEY,
            language: 'es',
            components: 'country:mx',
          }}
          onPress={(data) => {
            onChange('address_input')(data.description);
          }}
          onFail={(error) => {
            console.warn('[Places] error:', error);
          }}
          textInputProps={{
            placeholderTextColor: colors.textMuted,
          }}
          styles={{
            textInput: styles.placesInput,
            listView: styles.placesList,
            row: styles.placesRow,
            description: styles.placesDescription,
          }}
        />
      </View>

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

      {/* Modal de selección de categoría */}
      <Modal
        visible={categoryModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCategoryModalOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setCategoryModalOpen(false)}
        >
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Selecciona una categoría</Text>
            <FlatList
              data={BUSINESS_CATEGORIES}
              keyExtractor={(item) => item.value}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalItem}
                  onPress={() => {
                    onChange('category')(item.label);
                    setCategoryModalOpen(false);
                  }}
                >
                  <Text style={styles.modalItemText}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  sub: { color: colors.textMuted, marginBottom: spacing.md },
  error: { color: colors.danger, marginVertical: spacing.sm, textAlign: 'center' },

  fieldLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  dropdownTrigger: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    marginBottom: spacing.sm,
  },
  dropdownText: { fontSize: fontSize.md, color: colors.textPrimary },
  dropdownPlaceholder: { color: colors.textMuted },
  dropdownChevron: { fontSize: 16, color: colors.textMuted },

  placesWrapper: { minHeight: 50, marginBottom: spacing.sm },
  placesInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    height: 48,
    fontSize: fontSize.md,
    color: colors.textPrimary,
    backgroundColor: '#FFFFFF',
  },
  placesList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    marginTop: 4,
  },
  placesRow: { paddingHorizontal: spacing.md, paddingVertical: 10 },
  placesDescription: { fontSize: fontSize.sm, color: colors.textPrimary },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: spacing.md,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  modalItem: {
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: '#EEE',
  },
  modalItemText: { fontSize: fontSize.md, color: colors.textPrimary },
});
