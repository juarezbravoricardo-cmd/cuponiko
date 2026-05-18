/**
 * Business · Crear tarjeta de lealtad.
 *
 * Form:
 *  - name (TextField)
 *  - reward_description (TextField multiline)
 *  - stamps_required (slider 1..50 — implementado con +/- y tap-to-set)
 *  - design_color (chips de paleta)
 *  - icon (chips de emoji)
 *  - Preview de la tarjeta como la verá el consumer.
 *
 * Endpoint: POST /api/loyalty/create. Si el backend devuelve error, se muestra
 * el mensaje LITERAL.
 */

import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { Button } from '@/components/Button';
import { createLoyaltyCard } from '@/services/loyaltyApi';
import { extractApiError } from '@/services/api';
import { colors, fontSize, radii, spacing } from '@/utils/theme';

const COLOR_PALETTE = [
  '#F97316', // primary naranja
  '#7C3AED', // secondary morado
  '#16A34A', // success
  '#0EA5E9', // azul
  '#DC2626', // danger
  '#1F1F1F', // textPrimary
];

const ICON_OPTIONS = [
  '☕', '🍕', '🍔', '🍦', '✂️', '🛍️', '🎯', '⭐',
  '🍺', '🌮', '🍴', '🔧', '🛞', '🦷', '🩺', '💉', '💊',
];

function HelpTip({ title, message }: { title: string; message: string }) {
  return (
    <Pressable onPress={() => Alert.alert(title, message)} style={{ marginLeft: spacing.xs }}>
      <Text style={{ color: colors.secondary, fontSize: fontSize.md, fontWeight: '800' }}>ⓘ</Text>
    </Pressable>
  );
}

function SectionLabel({ text, hint }: { text: string; hint?: { title: string; message: string } }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
      <Text style={{ fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary }}>{text}</Text>
      {hint && <HelpTip title={hint.title} message={hint.message} />}
    </View>
  );
}

export default function BusinessLoyaltyNew() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [reward, setReward] = useState('');
  const [stamps, setStamps] = useState(10);
  const [color, setColor] = useState(COLOR_PALETTE[0]);
  const [icon, setIcon] = useState(ICON_OPTIONS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; reward?: string }>({});

  const onSubmit = async () => {
    setError(null);
    const fe: typeof fieldErrors = {};
    if (!name.trim()) fe.name = 'Nombre obligatorio.';
    if (!reward.trim()) fe.reward = 'Describe la recompensa que se canjea.';
    setFieldErrors(fe);
    if (Object.keys(fe).length > 0) return;

    setSubmitting(true);
    try {
      const r = await createLoyaltyCard({
        name: name.trim(),
        reward_description: reward.trim(),
        stamps_required: stamps,
        design_color: color,
        icon,
      });
      Alert.alert('Tarjeta creada', r.message || 'Tu tarjeta está activa.');
      router.replace('/(business)/loyalty');
    } catch (e) {
      setError(extractApiError(e).error);
    } finally {
      setSubmitting(false);
    }
  };

  const previewCard = useMemo(
    () => ({
      name: name || 'Nombre de tu tarjeta',
      reward: reward || 'Recompensa al completar',
      stamps,
      color,
      icon,
    }),
    [name, reward, stamps, color, icon]
  );

  return (
    <ScreenContainer>
      <Text style={styles.title}>Nueva tarjeta de lealtad</Text>

      <View style={styles.section}>
        <SectionLabel
          text="Nombre de la tarjeta"
          hint={{
            title: "Nombre de la tarjeta",
            message: "El nombre que verán tus clientes en su app. Hazlo descriptivo y atractivo.\n\nEjemplos:\n• Café de la casa\n• Corte de pelo VIP\n• Combo taquero\n• Lavado premium"
          }}
        />
        <TextField
          label=""
          placeholder="Ej. Café de la casa"
          value={name}
          onChangeText={setName}
          error={fieldErrors.name}
          maxLength={60}
        />
        <SectionLabel
          text="Recompensa"
          hint={{
            title: "Recompensa",
            message: "Lo que recibirá el cliente al completar todos los sellos. Sé específico para motivarlos.\n\nEjemplos:\n• Tu décimo café es gratis\n• 50% de descuento en tu próximo corte\n• Un combo taquero sin costo\n• Lavado de auto gratis"
          }}
        />
        <TextField
          label=""
          placeholder="Ej. Tu décimo café gratis"
          value={reward}
          onChangeText={setReward}
          multiline
          error={fieldErrors.reward}
          maxLength={140}
        />
      </View>

      <View style={styles.section}>
        <SectionLabel
          text="Sellos requeridos"
          hint={{
            title: "Sellos requeridos",
            message: "¿Cuántas visitas necesita el cliente para ganar la recompensa?\n\nRecomendaciones:\n• 5-8 sellos: ideal para productos de consumo frecuente (café, tacos)\n• 10-15 sellos: para servicios (cortes, lavados)\n• 20+ sellos: solo si la recompensa es de alto valor\n\nMenos sellos = más clientes completan la tarjeta = más fidelización."
          }}
        />
        <View style={styles.sliderRow}>
          <Pressable
            onPress={() => setStamps(Math.max(1, stamps - 1))}
            style={styles.stepBtn}
          >
            <Text style={styles.stepBtnText}>−</Text>
          </Pressable>
          <View style={styles.sliderTrack}>
            <View
              style={[
                styles.sliderFill,
                { width: `${(stamps / 50) * 100}%`, backgroundColor: color },
              ]}
            />
          </View>
          <Pressable
            onPress={() => setStamps(Math.min(50, stamps + 1))}
            style={styles.stepBtn}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </Pressable>
        </View>
        <Text style={styles.sliderValue}>{stamps} sellos</Text>
      </View>

      <View style={styles.section}>
        <SectionLabel
          text="Color de la tarjeta"
          hint={{
            title: "Color de la tarjeta",
            message: "El color que tendrá la tarjeta en la app de tus clientes. Elige uno que represente tu marca o negocio.\n\nTip: usa un color que contraste con el ícono que elijas."
          }}
        />
        <View style={styles.chipsRow}>
          {COLOR_PALETTE.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColor(c)}
              style={[
                styles.colorChip,
                { backgroundColor: c, borderColor: color === c ? colors.textPrimary : 'transparent' },
              ]}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <SectionLabel
          text="Ícono de la tarjeta"
          hint={{
            title: "Ícono de la tarjeta",
            message: "El ícono que aparecerá en la tarjeta. Elige el que mejor represente tu producto o servicio.\n\n☕ Cafetería  🍕 Pizzería  🍔 Hamburguesas\n🌮 Tacos  🍺 Bar  🍦 Helados\n✂️ Estética  🔧 Taller  🦷 Dentista\n🩺 Consultorio  💊 Farmacia  💉 Clínica"
          }}
        />
        <View style={styles.chipsRow}>
          {ICON_OPTIONS.map((g) => (
            <Pressable
              key={g}
              onPress={() => setIcon(g)}
              style={[
                styles.iconChip,
                { borderColor: icon === g ? colors.textPrimary : colors.border },
              ]}
            >
              <Text style={{ fontSize: 22 }}>{g}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Previsualización</Text>
        <View style={[styles.preview, { borderColor: previewCard.color }]}>
          <View style={[styles.previewIconWrap, { backgroundColor: previewCard.color }]}>
            <Text style={{ fontSize: 22, color: '#FFFFFF' }}>{previewCard.icon}</Text>
          </View>
          <Text style={styles.previewName}>{previewCard.name}</Text>
          <Text style={styles.previewReward}>{previewCard.reward}</Text>
          <View style={styles.previewProgress}>
            <View style={[styles.previewProgressFill, { backgroundColor: previewCard.color }]} />
          </View>
          <Text style={styles.previewCounter}>0 / {previewCard.stamps} sellos</Text>
        </View>
      </View>

      {!!error && <Text style={styles.error}>{error}</Text>}

      <Button title="Crear tarjeta" onPress={onSubmit} loading={submitting} />
      <Button title="Cancelar" variant="ghost" onPress={() => router.back()} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepBtn: {
    width: 40, height: 40, borderRadius: radii.pill,
    backgroundColor: colors.bgMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  stepBtnText: { fontSize: fontSize.lg, fontWeight: '800', color: colors.textPrimary },
  sliderTrack: {
    flex: 1, height: 8, backgroundColor: colors.border,
    borderRadius: radii.pill, overflow: 'hidden',
  },
  sliderFill: { height: '100%' },
  sliderValue: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: '600' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  colorChip: {
    width: 40, height: 40, borderRadius: radii.pill, borderWidth: 3,
  },
  iconChip: {
    width: 44, height: 44, borderRadius: radii.md, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgLight,
  },
  preview: {
    backgroundColor: colors.bgLight,
    borderRadius: radii.lg, padding: spacing.lg,
    borderWidth: 2, alignItems: 'center', gap: spacing.xs,
  },
  previewIconWrap: {
    width: 48, height: 48, borderRadius: radii.pill,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs,
  },
  previewName: { fontSize: fontSize.md, fontWeight: '800', color: colors.textPrimary },
  previewReward: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center' },
  previewProgress: {
    width: '100%', height: 8, backgroundColor: colors.border,
    borderRadius: radii.pill, marginTop: spacing.sm, overflow: 'hidden',
  },
  previewProgressFill: { height: '100%', width: '0%' },
  previewCounter: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
});
