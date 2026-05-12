/**
 * Business · Crear anuncio (AD-01).
 *
 * Form simplificado pero completo según el contrato:
 *   title, description?, image_url, discount_type, discount_value,
 *   precio_referencia (obligatorio si 2x1|free), start_date, end_date,
 *   redemption_limit, cost_type ('cpc'|'flat'), cost_value.
 *
 * Validación frontend solo es UX; el backend siempre revalida.
 *
 * Anti-patrón evitado:
 *  - No filtramos `precio_referencia` cuando NO es 2x1/free → el backend
 *    solo lo requiere para esos tipos. El form lo oculta dinámicamente.
 *  - Fechas en formato YYYY-MM-DD (no ISO completo).
 */

import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { Button } from '@/components/Button';
import { createAd, type CreateAdInput } from '@/services/adsApi';
import { extractApiError } from '@/services/api';
import { colors, fontSize, radii, spacing } from '@/utils/theme';

type DiscountType = CreateAdInput['discount_type'];
type CostType = CreateAdInput['cost_type'];

const DISCOUNT_OPTIONS: { value: DiscountType; label: string }[] = [
  { value: 'percent', label: '% off' },
  { value: 'fixed', label: '$ off' },
  { value: '2x1', label: '2x1' },
  { value: 'free', label: 'Gratis' },
];

const COST_OPTIONS: { value: CostType; label: string; hint: string }[] = [
  { value: 'cpc', label: 'CPC', hint: 'Pagas por cada clic' },
  { value: 'flat', label: 'Flat', hint: 'Pago único por la campaña' },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function BusinessAdNew() {
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [discountType, setDiscountType] = useState<DiscountType>('percent');
  const [discountValue, setDiscountValue] = useState('20');
  const [precioRef, setPrecioRef] = useState('');
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(plusDaysISO(7));
  const [redemptionLimit, setRedemptionLimit] = useState('100');
  const [costType, setCostType] = useState<CostType>('cpc');
  const [costValue, setCostValue] = useState('5');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiresPrecio = discountType === '2x1' || discountType === 'free';

  const fieldErrors = useMemo(() => {
    const fe: Record<string, string> = {};
    if (!title.trim()) fe.title = 'Título obligatorio.';
    if (!imageUrl.trim()) fe.imageUrl = 'URL de imagen obligatoria.';
    const dv = Number(discountValue);
    if (!Number.isFinite(dv) || dv <= 0) fe.discountValue = 'Valor inválido.';
    if (requiresPrecio) {
      const pr = Number(precioRef);
      if (!Number.isFinite(pr) || pr <= 0) {
        fe.precioRef = 'Obligatorio para 2x1 y gratis.';
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) fe.startDate = 'Formato YYYY-MM-DD.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) fe.endDate = 'Formato YYYY-MM-DD.';
    if (Number(redemptionLimit) < 1) fe.redemptionLimit = 'Mínimo 1.';
    if (Number(costValue) <= 0) fe.costValue = 'Mayor a 0.';
    return fe;
  }, [title, imageUrl, discountValue, precioRef, requiresPrecio, startDate, endDate, redemptionLimit, costValue]);

  const onSubmit = async () => {
    setError(null);
    if (Object.keys(fieldErrors).length > 0) return;
    setSubmitting(true);
    try {
      const payload: CreateAdInput = {
        title: title.trim(),
        description: description.trim() || undefined,
        image_url: imageUrl.trim(),
        discount_type: discountType,
        discount_value: Number(discountValue),
        precio_referencia: requiresPrecio ? Number(precioRef) : null,
        start_date: startDate,
        end_date: endDate,
        redemption_limit: Number(redemptionLimit),
        cost_type: costType,
        cost_value: Number(costValue),
      };
      const r = await createAd(payload);
      Alert.alert('Anuncio creado', r.message || 'Tu anuncio está activo.');
      router.replace('/(business)/ads');
    } catch (e) {
      setError(extractApiError(e).error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenContainer>
      <Text style={styles.title}>Nuevo anuncio</Text>
      <Text style={styles.sub}>
        Crea una promoción destacada para aparecer en el mapa de los consumidores cercanos.
      </Text>

      <Section title="Contenido">
        <TextField
          label="Título"
          placeholder="Ej. 2x1 en café latte"
          value={title}
          onChangeText={setTitle}
          maxLength={80}
          error={fieldErrors.title}
        />
        <TextField
          label="Descripción"
          placeholder="Detalles que verá el cliente"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={200}
        />
        <TextField
          label="URL de imagen"
          placeholder="https://..."
          value={imageUrl}
          onChangeText={setImageUrl}
          autoCapitalize="none"
          error={fieldErrors.imageUrl}
        />
      </Section>

      <Section title="Descuento">
        <ChipsRow
          options={DISCOUNT_OPTIONS}
          value={discountType}
          onChange={setDiscountType}
        />
        <TextField
          label={discountType === 'percent' ? 'Porcentaje' : 'Valor'}
          placeholder="10"
          value={discountValue}
          onChangeText={setDiscountValue}
          keyboardType="numeric"
          error={fieldErrors.discountValue}
        />
        {requiresPrecio && (
          <TextField
            label="Precio de referencia (MXN)"
            placeholder="120"
            value={precioRef}
            onChangeText={setPrecioRef}
            keyboardType="numeric"
            error={fieldErrors.precioRef}
          />
        )}
      </Section>

      <Section title="Vigencia y límite">
        <TextField
          label="Inicio (YYYY-MM-DD)"
          placeholder="2026-05-12"
          value={startDate}
          onChangeText={setStartDate}
          autoCapitalize="none"
          error={fieldErrors.startDate}
        />
        <TextField
          label="Fin (YYYY-MM-DD)"
          placeholder="2026-05-19"
          value={endDate}
          onChangeText={setEndDate}
          autoCapitalize="none"
          error={fieldErrors.endDate}
        />
        <TextField
          label="Límite de redenciones totales"
          placeholder="100"
          value={redemptionLimit}
          onChangeText={setRedemptionLimit}
          keyboardType="numeric"
          error={fieldErrors.redemptionLimit}
        />
      </Section>

      <Section title="Costo">
        <ChipsRow
          options={COST_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          value={costType}
          onChange={setCostType}
        />
        <Text style={styles.hint}>
          {COST_OPTIONS.find((o) => o.value === costType)?.hint}
        </Text>
        <TextField
          label={costType === 'cpc' ? 'MXN por clic' : 'MXN total'}
          placeholder={costType === 'cpc' ? '5' : '500'}
          value={costValue}
          onChangeText={setCostValue}
          keyboardType="numeric"
          error={fieldErrors.costValue}
        />
      </Section>

      {!!error && <Text style={styles.error}>{error}</Text>}

      <Button
        title="Crear anuncio"
        onPress={onSubmit}
        loading={submitting}
        disabled={Object.keys(fieldErrors).length > 0}
      />
      <Button title="Cancelar" variant="ghost" onPress={() => router.back()} />
    </ScreenContainer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ChipsRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.chipsRow}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  sub: { color: colors.textMuted, fontSize: fontSize.sm },
  section: { gap: spacing.sm, marginTop: spacing.md },
  sectionTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  hint: { fontSize: fontSize.xs, color: colors.textMuted },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bgLight,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textPrimary, fontWeight: '600', fontSize: fontSize.sm },
  chipTextActive: { color: '#FFFFFF' },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center', marginVertical: spacing.sm },
});
