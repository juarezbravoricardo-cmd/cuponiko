/**
 * Wizard para crear un cupón (CPN-01).
 *
 * Analogía: formulario de solicitud. El empresario llena datos paso a paso y
 * al final enviamos un único POST. Validaciones frontend "amigables" pero
 * la validación DURA vive en el backend (AP-01 del spec maestro).
 *
 * Pasos:
 *   1) Título, descripción.
 *   2) Tipo y valor del descuento (+ precio_referencia si 2x1/free).
 *   3) Vigencia.
 *   4) Límites (por usuario, total).
 *   5) Flags: transferible, acumulable, single_use.
 *
 * El botón "Crear cupón" está en el último paso y desactiva al enviar.
 * Al recibir error mostramos el mensaje TEXTUAL del backend (AP-06).
 */

import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { Button } from '@/components/Button';
import {
  createCoupon,
  type CreateCouponInput,
  type DiscountType,
} from '@/services/couponsApi';
import { colors, fontSize, radii, spacing } from '@/utils/theme';

const DISCOUNT_TYPES: { key: DiscountType; label: string }[] = [
  { key: 'percent', label: '% de descuento' },
  { key: 'fixed', label: 'Monto fijo' },
  { key: '2x1', label: '2x1' },
  { key: 'free', label: 'Gratis' },
];

export default function NewCoupon() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [discountType, setDiscountType] = useState<DiscountType>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [precioRef, setPrecioRef] = useState('');

  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState('');

  const [usagePerUser, setUsagePerUser] = useState('1');
  const [totalLimit, setTotalLimit] = useState('');

  const [transferable, setTransferable] = useState(false);
  const [accumulable, setAccumulable] = useState(false);
  const [singleUse, setSingleUse] = useState(false);

  const needsReferencia = discountType === '2x1' || discountType === 'free';

  const validateStep = (s: number): string | null => {
    if (s === 1) {
      if (title.trim().length < 3) return 'El título debe tener al menos 3 caracteres.';
    }
    if (s === 2) {
      const v = Number(discountValue);
      if (!Number.isFinite(v) || v < 0) return 'Ingresa un valor de descuento válido.';
      if (discountType === 'percent' && (v <= 0 || v > 100)) {
        return 'El porcentaje debe estar entre 1 y 100.';
      }
      if (needsReferencia && (!precioRef || Number(precioRef) <= 0)) {
        return 'Para 2x1 o Gratis necesitas precio de referencia.';
      }
    }
    if (s === 3) {
      if (!endDate) return 'Ingresa la fecha de fin.';
      if (endDate < startDate) return 'La fecha fin no puede ser anterior a la de inicio.';
    }
    if (s === 4) {
      if (Number(usagePerUser) < 1) return 'Al menos 1 uso por persona.';
      if (Number(totalLimit) < 1) return 'Total de usos debe ser mayor a 0.';
    }
    return null;
  };

  const goNext = () => {
    const err = validateStep(step);
    if (err) return Alert.alert('Revisa', err);
    setStep((s) => Math.min(5, s + 1));
  };

  const submit = async () => {
    const err = validateStep(4);
    if (err) return Alert.alert('Revisa', err);
    setSubmitting(true);
    try {
      const payload: CreateCouponInput = {
        title: title.trim(),
        description: description.trim() || undefined,
        discount_type: discountType,
        discount_value: Number(discountValue),
        precio_referencia: needsReferencia ? Number(precioRef) : undefined,
        start_date: startDate,
        end_date: endDate,
        usage_limit_per_user: Number(usagePerUser),
        total_usage_limit: Number(totalLimit),
        transferable,
        accumulable,
        single_use: singleUse,
      };
      const r = await createCoupon(payload);
      Alert.alert('Cupón creado', r.message, [
        {
          text: 'Ver mis cupones',
          onPress: () => router.replace('/(business)/coupons'),
        },
      ]);
    } catch (e) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'No pudimos crear el cupón.';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenContainer>
      <Text style={styles.step}>Paso {step} de 5</Text>

      {step === 1 && (
        <View style={styles.block}>
          <Label text="Título" />
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Café al 2x1 de 3pm a 6pm"
            maxLength={80}
          />
          <Label text="Descripción (opcional)" />
          <TextInput
            style={[styles.input, styles.multiline]}
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={280}
            placeholder="Condiciones, horarios, etc."
          />
        </View>
      )}

      {step === 2 && (
        <View style={styles.block}>
          <Label text="Tipo de descuento" />
          <View style={styles.chips}>
            {DISCOUNT_TYPES.map((d) => (
              <Pressable
                key={d.key}
                style={[styles.chip, discountType === d.key && styles.chipActive]}
                onPress={() => setDiscountType(d.key)}
              >
                <Text
                  style={[styles.chipTxt, discountType === d.key && styles.chipTxtActive]}
                >
                  {d.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Label text={discountType === 'percent' ? 'Porcentaje (%)' : 'Valor'} />
          <TextInput
            style={styles.input}
            value={discountValue}
            onChangeText={setDiscountValue}
            keyboardType="decimal-pad"
          />
          {needsReferencia && (
            <>
              <Label text="Precio de referencia (obligatorio para 2x1/Gratis)" />
              <TextInput
                style={styles.input}
                value={precioRef}
                onChangeText={setPrecioRef}
                keyboardType="decimal-pad"
              />
            </>
          )}
        </View>
      )}

      {step === 3 && (
        <View style={styles.block}>
          <Label text="Fecha de inicio (YYYY-MM-DD)" />
          <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} />
          <Label text="Fecha de fin (YYYY-MM-DD)" />
          <TextInput style={styles.input} value={endDate} onChangeText={setEndDate} />
        </View>
      )}

      {step === 4 && (
        <View style={styles.block}>
          <Label text="Usos por persona" />
          <TextInput
            style={styles.input}
            value={usagePerUser}
            onChangeText={setUsagePerUser}
            keyboardType="number-pad"
          />
          <Label text="Total de usos disponibles" />
          <TextInput
            style={styles.input}
            value={totalLimit}
            onChangeText={setTotalLimit}
            keyboardType="number-pad"
          />
        </View>
      )}

      {step === 5 && (
        <View style={styles.block}>
          <Toggle
            label="Transferible (solo Premium)"
            value={transferable}
            onChange={setTransferable}
          />
          <Toggle
            label="Acumulable con otros cupones"
            value={accumulable}
            onChange={setAccumulable}
          />
          <Toggle label="Uso único por persona" value={singleUse} onChange={setSingleUse} />
        </View>
      )}

      <ScrollView horizontal contentContainerStyle={styles.navRow}>
        {step > 1 && (
          <Button title="Atrás" variant="ghost" onPress={() => setStep((s) => s - 1)} />
        )}
        {step < 5 ? (
          <Button title="Continuar" onPress={goNext} />
        ) : (
          <Button title="Crear cupón" onPress={submit} loading={submitting} />
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function Label({ text }: { text: string }) {
  return <Text style={styles.label}>{text}</Text>;
}
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.primary }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  step: { color: colors.textMuted },
  block: { gap: spacing.sm },
  label: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { color: colors.textMuted, fontWeight: '700' },
  chipTxtActive: { color: '#FFF' },
  navRow: { gap: spacing.md, marginTop: spacing.lg },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  toggleLabel: { color: colors.textPrimary, flex: 1, paddingRight: spacing.md },
});
