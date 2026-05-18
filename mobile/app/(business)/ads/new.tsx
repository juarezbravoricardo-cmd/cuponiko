/**
 * Business · Crear anuncio (AD-01).
 *
 * Form rediseñado con paquetes fijos + Stripe Checkout:
 *   title, description?, image_url, discount_type, discount_value,
 *   precio_referencia (obligatorio si 2x1|free), redemption_limit, package.
 *
 * Las fechas se calculan automáticamente CUANDO el pago se confirma (webhook).
 * El anuncio se crea como 'pending_payment' y se activa por webhook de Stripe.
 *
 * Anti-patrón evitado:
 *  - No filtramos `precio_referencia` cuando NO es 2x1/free → el backend
 *    solo lo requiere para esos tipos. El form lo oculta dinámicamente.
 */

import React, { useMemo, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { Button } from '@/components/Button';
import { createAd, uploadAdImage, type CreateAdInput } from '@/services/adsApi';
import { extractApiError } from '@/services/api';
import { colors, fontSize, radii, spacing } from '@/utils/theme';

type DiscountType = CreateAdInput['discount_type'];

const DISCOUNT_OPTIONS: { value: DiscountType; label: string }[] = [
  { value: 'percent', label: '% Descuento' },
  { value: 'fixed', label: '$ Pesos off' },
  { value: '2x1', label: '2x1' },
  { value: 'free', label: 'Gratis' },
];

const AD_PACKAGES = [
  { key: 'basico' as const, icon: '📦', label: 'Básico', days: 7, price: 99 },
  { key: 'destacado' as const, icon: '🔥', label: 'Destacado', days: 15, price: 199 },
  { key: 'premium' as const, icon: '👑', label: 'Premium', days: 30, price: 399 },
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

export default function BusinessAdNew() {
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [discountType, setDiscountType] = useState<DiscountType>('percent');
  const [discountValue, setDiscountValue] = useState('20');
  const [precioRef, setPrecioRef] = useState('');
  const [redemptionLimit, setRedemptionLimit] = useState('100');
  const [selectedPackage, setSelectedPackage] = useState<'basico' | 'destacado' | 'premium' | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiresPrecio = discountType === '2x1' || discountType === 'free';

  const fieldErrors = useMemo(() => {
    const fe: Record<string, string> = {};
    if (!title.trim()) fe.title = 'Título obligatorio.';
    if (!imageUrl.trim()) fe.imageUrl = 'Selecciona una imagen desde tu galería.';
    const dv = Number(discountValue);
    if (!Number.isFinite(dv) || dv <= 0) fe.discountValue = 'Valor inválido.';
    if (requiresPrecio) {
      const pr = Number(precioRef);
      if (!Number.isFinite(pr) || pr <= 0) {
        fe.precioRef = 'Obligatorio para 2x1 y gratis.';
      }
    }
    if (Number(redemptionLimit) < 1) fe.redemptionLimit = 'Mínimo 1.';
    if (!selectedPackage) fe.package = 'Selecciona un paquete.';
    return fe;
  }, [title, imageUrl, discountValue, precioRef, requiresPrecio, redemptionLimit, selectedPackage]);

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permiso necesario', 'Necesitamos acceso a tu galería para subir la imagen del anuncio.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    setImagePreview(asset.uri);
    setUploading(true);

    try {
      const url = await uploadAdImage(asset.uri);
      setImageUrl(url);
    } catch {
      Alert.alert('Error', 'No pudimos subir la imagen. Intenta de nuevo.');
      setImagePreview(null);
    } finally {
      setUploading(false);
    }
  };

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
        redemption_limit: Number(redemptionLimit),
        package: selectedPackage!,
      };
      const r = await createAd(payload);
      const pkg = AD_PACKAGES.find(p => p.key === selectedPackage);
      if (r.checkout_url) {
        Alert.alert(
          '¡Anuncio creado!',
          `Tu anuncio con el paquete ${pkg?.label} fue creado exitosamente.\n\nEstará en validación mientras se confirma tu pago de $${pkg?.price} MXN.\n\nUna vez confirmado el pago, se pondrá en circulación por ${pkg?.days} días automáticamente.`,
          [
            { text: 'Ir a pagar', onPress: () => { Linking.openURL(r.checkout_url!); router.replace('/(business)/ads'); } },
            { text: 'Pagar después', style: 'cancel', onPress: () => router.replace('/(business)/ads') },
          ]
        );
      } else {
        Alert.alert('Anuncio creado', r.message);
        router.replace('/(business)/ads');
      }
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
        <View>
          <SectionLabel text="Título" hint={{ title: "Título del anuncio", message: "Es lo que verá el consumidor en el carrusel del mapa. Hazlo llamativo y directo.\n\nEjemplos:\n• 2x1 en café latte esta semana\n• Corte de cabello $99 solo hoy\n• Pizza familiar + refresco gratis" }} />
          <TextField
            label=""
            placeholder="Ej. 2x1 en café latte"
            value={title}
            onChangeText={setTitle}
            maxLength={80}
            error={fieldErrors.title}
          />
        </View>
        <View>
          <SectionLabel text="Descripción" hint={{ title: "Descripción (opcional)", message: "Detalla condiciones o restricciones de tu promoción.\n\nEjemplos:\n• Válido solo en sucursal centro\n• No acumulable con otras promos\n• Hasta agotar existencias" }} />
          <TextField
            label=""
            placeholder="Detalles que verá el cliente"
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={200}
          />
        </View>
        <View>
          <SectionLabel text="Imagen del anuncio (16:9)" hint={{ title: "Imagen del anuncio", message: "Sube una foto atractiva de tu producto o promoción. Se mostrará en el carrusel del mapa.\n\nRecomendaciones:\n• Tamaño ideal: 1280x720 px\n• Formato: JPG, PNG o WebP\n• Buena iluminación y sin texto excesivo" }} />
          {imagePreview ? (
            <View style={styles.imagePreviewContainer}>
              <Image source={{ uri: imagePreview }} style={styles.imagePreview} resizeMode="cover" />
              {uploading && (
                <View style={styles.imageUploading}>
                  <Text style={styles.imageUploadingTxt}>Subiendo…</Text>
                </View>
              )}
              <Pressable style={styles.imageChangeBtn} onPress={pickImage}>
                <Text style={styles.imageChangeTxt}>Cambiar imagen</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.imagePicker} onPress={pickImage}>
              <Text style={styles.imagePickerIcon}>📷</Text>
              <Text style={styles.imagePickerTxt}>Toca para seleccionar imagen de tu galería</Text>
            </Pressable>
          )}
          {fieldErrors.imageUrl && !uploading && !imagePreview && (
            <Text style={styles.fieldError}>{fieldErrors.imageUrl}</Text>
          )}
        </View>
      </Section>

      <Section title="Descuento">
        <View>
          <SectionLabel text="Tipo de descuento" hint={{ title: "Tipo de descuento", message: "Elige cómo se aplica el descuento:\n\n• % Descuento → Porcentaje (ej: 15% de descuento)\n• $ Pesos off → Monto fijo en pesos (ej: $50 menos)\n• 2x1 → Paga uno, llévate dos\n• Gratis → Producto sin costo" }} />
          <ChipsRow
            options={DISCOUNT_OPTIONS}
            value={discountType}
            onChange={setDiscountType}
          />
        </View>
        <View>
          <SectionLabel text="Valor del descuento" hint={{ title: "Valor del descuento", message: "Si elegiste %, escribe solo el número (ej: 15 para 15%).\nSi elegiste $ off, escribe la cantidad en pesos (ej: 50 para $50 de descuento).\nPara 2x1 y Gratis, pon 1." }} />
          <TextField
            label=""
            placeholder="10"
            value={discountValue}
            onChangeText={setDiscountValue}
            keyboardType="numeric"
            error={fieldErrors.discountValue}
          />
        </View>
        {requiresPrecio && (
          <View>
            <SectionLabel text="Precio de referencia" hint={{ title: "Precio de referencia", message: "El precio normal del producto para que el cliente vea cuánto ahorra.\n\nEjemplo: si tu café cuesta $45 y ofreces 2x1, escribe 45." }} />
            <TextField
              label=""
              placeholder="120"
              value={precioRef}
              onChangeText={setPrecioRef}
              keyboardType="numeric"
              error={fieldErrors.precioRef}
            />
          </View>
        )}
      </Section>

      <Section title="Alcance">
        <View>
          <SectionLabel text="Límite de redenciones" hint={{ title: "Límite de redenciones", message: "¿Cuántos clientes en total pueden canjear esta oferta?\n\nEjemplo: 100 = los primeros 100 clientes que vean tu anuncio y canjeen.\n\nCuando se agoten los canjes, el anuncio deja de mostrar el cupón." }} />
          <TextField
            label=""
            placeholder="100"
            value={redemptionLimit}
            onChangeText={setRedemptionLimit}
            keyboardType="numeric"
            error={fieldErrors.redemptionLimit}
          />
        </View>
      </Section>

      <Section title="Elige tu paquete">
        <SectionLabel
          text="Duración de la campaña"
          hint={{
            title: "Paquetes de anuncio",
            message: "Elige cuánto tiempo quieres que tu anuncio aparezca en el mapa de los consumidores cercanos.\n\n📦 Básico: 7 días — ideal para probar\n🔥 Destacado: 15 días — más exposición\n👑 Premium: 30 días — máxima visibilidad\n\nEl anuncio se activa al confirmar el pago y se desactiva automáticamente al terminar los días."
          }}
        />
        <View style={styles.packagesContainer}>
          {AD_PACKAGES.map((pkg) => {
            const isSelected = selectedPackage === pkg.key;
            return (
              <Pressable
                key={pkg.key}
                style={[styles.packageCard, isSelected && styles.packageCardSelected]}
                onPress={() => setSelectedPackage(pkg.key)}
              >
                <Text style={styles.packageIcon}>{pkg.icon}</Text>
                <Text style={[styles.packageLabel, isSelected && styles.packageLabelSelected]}>{pkg.label}</Text>
                <Text style={[styles.packageDays, isSelected && styles.packageDaysSelected]}>{pkg.days} días</Text>
                <Text style={[styles.packagePrice, isSelected && styles.packagePriceSelected]}>${pkg.price} MXN</Text>
              </Pressable>
            );
          })}
        </View>
        {fieldErrors.package && <Text style={styles.fieldError}>{fieldErrors.package}</Text>}
      </Section>

      {!!error && <Text style={styles.error}>{error}</Text>}

      <Button
        title={selectedPackage ? `Crear y pagar $${AD_PACKAGES.find(p => p.key === selectedPackage)?.price} MXN` : 'Selecciona un paquete'}
        onPress={onSubmit}
        loading={submitting}
        disabled={Object.keys(fieldErrors).length > 0 || !selectedPackage}
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
  imagePicker: {
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radii.lg,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgMuted,
  },
  imagePickerIcon: { fontSize: 36 },
  imagePickerTxt: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'center' },
  imagePreviewContainer: { borderRadius: radii.lg, overflow: 'hidden' },
  imagePreview: { width: '100%', aspectRatio: 16 / 9, borderRadius: radii.lg },
  imageUploading: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center',
  },
  imageUploadingTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: fontSize.md },
  imageChangeBtn: {
    marginTop: spacing.sm,
    alignSelf: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  imageChangeTxt: { color: colors.secondary, fontWeight: '700', fontSize: fontSize.sm },
  fieldError: { color: colors.danger, fontSize: fontSize.xs, marginTop: 2 },
  packagesContainer: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  packageCard: {
    flex: 1, borderWidth: 2, borderColor: colors.border, borderRadius: radii.lg,
    paddingVertical: spacing.lg, paddingHorizontal: spacing.sm, alignItems: 'center',
    gap: spacing.xs, backgroundColor: colors.bgLight,
  },
  packageCardSelected: { borderColor: colors.primary, backgroundColor: colors.primary + '10' },
  packageIcon: { fontSize: 28 },
  packageLabel: { fontSize: fontSize.sm, fontWeight: '800', color: colors.textPrimary },
  packageLabelSelected: { color: colors.primary },
  packageDays: { fontSize: fontSize.xs, color: colors.textMuted },
  packageDaysSelected: { color: colors.primary },
  packagePrice: { fontSize: fontSize.lg, fontWeight: '900', color: colors.textPrimary },
  packagePriceSelected: { color: colors.primary },
});
