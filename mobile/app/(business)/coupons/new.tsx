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
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
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
          <Label
            text="Título"
            hint={{
              title: 'Título del cupón',
              message:
                'Es lo primero que verá el cliente. Sé claro y atractivo.\n\nEjemplos:\n• 2x1 en cafés de 3pm a 6pm\n• 15% de descuento en combos\n• Postre gratis en tu primera visita',
            }}
          />
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Café al 2x1 de 3pm a 6pm"
            maxLength={80}
          />
          <Label
            text="Descripción (opcional)"
            hint={{
              title: 'Descripción',
              message:
                'Detalla condiciones o restricciones del cupón.\n\nEjemplo:\n• Válido solo en sucursal centro\n• No acumulable con otras promociones\n• Aplica en compras mayores a $100',
            }}
          />
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
          <Label
            text="Tipo de descuento"
            hint={{
              title: 'Tipo de descuento',
              message:
                '• % de descuento: porcentaje del total (ej: 15% off)\n• Monto fijo: descuento en pesos (ej: $50 off)\n• 2x1: el cliente paga uno y se lleva dos\n• Gratis: el producto es gratuito',
            }}
          />
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
          <Label
            text={discountType === 'percent' ? 'Porcentaje (%)' : 'Valor'}
            hint={{
              title: 'Valor del descuento',
              message:
                'Si elegiste %, escribe solo el número (ej: 15 para 15%).\nSi elegiste monto fijo, escribe la cantidad en pesos (ej: 50 para $50 de descuento).',
            }}
          />
          <TextInput
            style={styles.input}
            value={discountValue}
            onChangeText={setDiscountValue}
            keyboardType="decimal-pad"
          />
          {needsReferencia && (
            <>
              <Label
                text="Precio de referencia (obligatorio para 2x1/Gratis)"
                hint={{
                  title: 'Precio de referencia',
                  message:
                    'El precio normal del producto para que el cliente sepa cuánto ahorra.\n\nEjemplo: si ofreces 2x1 en café de $45, escribe 45.',
                }}
              />
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
          <Label
            text="Fecha de inicio (YYYY-MM-DD)"
            hint={{
              title: 'Fecha de inicio',
              message:
                'El día desde el cual el cupón estará disponible para los clientes.\n\nFormato: AAAA-MM-DD (ej: 2026-05-17)',
            }}
          />
          <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} />
          <Label
            text="Fecha de fin (YYYY-MM-DD)"
            hint={{
              title: 'Fecha de fin',
              message:
                'El último día en que el cupón se puede canjear. Después de esta fecha se desactiva automáticamente.\n\nFormato: AAAA-MM-DD',
            }}
          />
          <TextInput style={styles.input} value={endDate} onChangeText={setEndDate} />
        </View>
      )}

      {step === 4 && (
        <View style={styles.block}>
          <Label
            text="Usos por persona"
            hint={{
              title: 'Usos por persona',
              message:
                '¿Cuántas veces puede usar este cupón cada cliente?\n\n• 1 = solo una vez por persona\n• 3 = hasta 3 veces por persona',
            }}
          />
          <TextInput
            style={styles.input}
            value={usagePerUser}
            onChangeText={setUsagePerUser}
            keyboardType="number-pad"
          />
          <Label
            text="Total de usos disponibles"
            hint={{
              title: 'Total de usos disponibles',
              message:
                '¿Cuántos canjes TOTALES permite este cupón entre todos los clientes?\n\nEjemplo: 50 significa que los primeros 50 clientes que lo canjeen lo aprovechan.',
            }}
          />
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
            hint={{
              title: 'Transferible',
              message:
                'Si está activado, el cliente puede compartir este cupón con otra persona. Útil para marketing viral.\n\n⭐ Función exclusiva del plan Premium.',
            }}
          />
          <Toggle
            label="Acumulable con otros cupones"
            value={accumulable}
            onChange={setAccumulable}
            hint={{
              title: 'Acumulable',
              message:
                'Si está activado, el cliente puede usar este cupón junto con otros cupones en la misma compra.',
            }}
          />
          <Toggle
            label="Uso único por persona"
            value={singleUse}
            onChange={setSingleUse}
            hint={{
              title: 'Uso único',
              message:
                "Si está activado, cada persona solo puede canjear este cupón una sola vez, sin importar lo que diga 'usos por persona'.",
            }}
          />
        </View>
      )}

      <View style={styles.navRow}>
        {step > 1 && (
          <View style={{ flex: 1 }}>
            <Button title="Atrás" variant="ghost" onPress={() => setStep((s) => s - 1)} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          {step < 5 ? (
            <Button title="Continuar" onPress={goNext} />
          ) : (
            <Button title="Crear cupón" onPress={submit} loading={submitting} />
          )}
        </View>
      </View>
    </ScreenContainer>
  );
}

function HelpTip({ title, message }: { title: string; message: string }) {
  return (
    <Pressable
      onPress={() => Alert.alert(title, message)}
      style={{ marginLeft: spacing.xs }}
      hitSlop={8}
    >
      <Text style={{ color: colors.secondary, fontSize: fontSize.md, fontWeight: '800' }}>
        ⓘ
      </Text>
    </Pressable>
  );
}

function Label({
  text,
  hint,
}: {
  text: string;
  hint?: { title: string; message: string };
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={styles.label}>{text}</Text>
      {hint && <HelpTip title={hint.title} message={hint.message} />}
    </View>
  );
}
function Toggle({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: { title: string; message: string };
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: spacing.md }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint && <HelpTip title={hint.title} message={hint.message} />}
      </View>
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
  navRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  toggleLabel: { color: colors.textPrimary, flex: 1, paddingRight: spacing.md },
});
