/**
 * Cuponiko — Pantalla de Upgrade a Premium
 * Ruta: /business/upgrade
 *
 * Pricing v2: dos opciones de pago bajo el mismo Product Premium.
 *  - Plan Mundialista trimestral ($1,047 MXN, equivalente a $349/mes) — solo
 *    disponible hasta el 19 julio 2026 23:59 CST (fin del Mundial).
 *  - Premium mensual ($399 MXN/mes) — siempre disponible.
 *
 * El backend (BILL-01) recibe `billing_interval` y selecciona el Stripe Price
 * correcto desde `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_QUARTERLY`.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { api, extractApiError } from '@/services/api';

// ─────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────

const FEATURES = [
  { label: 'Cupones activos',            free: '1',        premium: 'Ilimitados',  freeHighlight: true },
  { label: 'Tarjetas de lealtad',        free: '1',        premium: 'Ilimitadas',  freeHighlight: false },
  { label: 'Push segmentadas',           free: '—',        premium: '✓',           freeHighlight: false },
  { label: 'Historial de clientes',      free: '7 días',   premium: 'Completo',    freeHighlight: false },
  { label: 'Cupones transferibles',      free: '—',        premium: '✓',           freeHighlight: false },
  { label: 'Exportar métricas PDF',      free: '—',        premium: '✓',           freeHighlight: false },
  { label: 'Anuncios en carrusel',       free: 'Estándar', premium: 'Preferencial', freeHighlight: false },
  { label: 'Visibilidad en mapa',        free: 'Normal',   premium: 'Prioridad',   freeHighlight: false },
];

const PLANS = {
  quarterly: {
    id: 'quarterly',
    title: 'Plan Mundialista',
    price: '$1,047',
    period: '/trimestre',
    subtitle: 'Equivale a $349/mes',
    detail: 'Un solo pago, 3 meses de Premium completo.',
    badgeSave: 'Ahorra $150',
    badgeEvent: 'Solo durante el Mundial',
    buttonText: 'Activar Plan Mundialista',
  },
  monthly: {
    id: 'monthly',
    title: 'Premium mensual',
    price: '$399',
    period: '/mes',
    subtitle: '$13.30 al día — menos que un café',
    detail: null as string | null,
    badgeSave: null as string | null,
    badgeEvent: null as string | null,
    buttonText: 'Activar Premium',
  },
};

const FAQ_ITEMS = [
  {
    q: '¿Qué pasa cuando termina mi trimestre?',
    a: 'Tu plan se renueva automáticamente. Puedes cancelar o cambiar a mensual en cualquier momento desde tu perfil.',
  },
  {
    q: '¿Puedo cambiar de plan después?',
    a: 'Sí. El cambio aplica al terminar tu ciclo actual. No pierdes días pagados.',
  },
  {
    q: '¿Qué pasa si cancelo?',
    a: 'Tu plan Premium se mantiene activo hasta el fin del período pagado. Después regresas al plan Gratuito sin perder tus datos.',
  },
];

const MUNDIAL_DEADLINE = new Date('2026-07-19T23:59:59-06:00').getTime();

// ─────────────────────────────────────────────
// HOOK: useCountdown
// ─────────────────────────────────────────────

function useCountdown(deadline: number) {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0, expired: false });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    function calculate() {
      const now = Date.now();
      const diff = Math.max(0, deadline - now);

      if (diff === 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0, expired: true });
        if (intervalRef.current) clearInterval(intervalRef.current);
        return;
      }

      setTimeLeft({
        days: Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000),
        seconds: Math.floor((diff % 60000) / 1000),
        expired: false,
      });
    }

    calculate();
    intervalRef.current = setInterval(calculate, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [deadline]);

  return timeLeft;
}

// ─────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────

export default function UpgradeScreen() {
  const countdown = useCountdown(MUNDIAL_DEADLINE);
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'quarterly'>(
    countdown.expired ? 'monthly' : 'quarterly'
  );
  const [loading, setLoading] = useState(false);
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(null);

  useEffect(() => {
    if (countdown.expired) setSelectedPlan('monthly');
  }, [countdown.expired]);

  const handleUpgrade = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.post('/api/billing/create-checkout-session', {
        billing_interval: selectedPlan,
      });
      // El backend devuelve { data: { checkout_url, session_id } }
      const checkoutUrl: string | undefined =
        res.data?.data?.checkout_url ?? res.data?.checkout_url;
      if (checkoutUrl) {
        await Linking.openURL(checkoutUrl);
      } else {
        Alert.alert('Error', 'No se obtuvo URL de pago.');
      }
    } catch (err: any) {
      const msg = extractApiError(err).error || 'No se pudo iniciar el pago. Intenta de nuevo.';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  }, [selectedPlan]);

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Lleva tu negocio al siguiente nivel</Text>
        <Text style={styles.headerSubtitle}>
          Cupones ilimitados, push segmentadas, métricas completas y visibilidad prioritaria en el mapa.
        </Text>
      </View>

      <View style={styles.featureTable}>
        <View style={styles.featureHead}>
          <Text style={[styles.featureHeadCell, styles.fLabel]}>Feature</Text>
          <Text style={[styles.featureHeadCell, styles.fValue]}>Gratis</Text>
          <Text style={[styles.featureHeadCell, styles.fValueP]}>Premium</Text>
        </View>
        {FEATURES.map((f, i) => (
          <View key={f.label} style={[styles.featureRow, i % 2 === 0 && styles.featureRowAlt]}>
            <Text style={[styles.featureCell, styles.fLabel]}>{f.label}</Text>
            <Text style={[
              styles.featureCell,
              styles.fValue,
              f.freeHighlight && styles.freeHighlight
            ]}>
              {f.free}
            </Text>
            <Text style={[styles.featureCell, styles.fValueP]}>{f.premium}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Elige tu plan</Text>

      {!countdown.expired && (
        <View style={styles.countdownWrap}>
          <Text style={styles.countdownLabel}>⏱ La oferta termina con el Mundial</Text>
          <View style={styles.countdownBoxes}>
            <CountdownBox value={pad(countdown.days)} unit="días" />
            <CountdownBox value={pad(countdown.hours)} unit="hrs" />
            <CountdownBox value={pad(countdown.minutes)} unit="min" />
            <CountdownBox value={pad(countdown.seconds)} unit="seg" />
          </View>
        </View>
      )}

      {!countdown.expired && (
        <PlanCard
          plan={PLANS.quarterly}
          selected={selectedPlan === 'quarterly'}
          onSelect={() => setSelectedPlan('quarterly')}
        />
      )}

      <PlanCard
        plan={PLANS.monthly}
        selected={selectedPlan === 'monthly'}
        onSelect={() => setSelectedPlan('monthly')}
      />

      {!countdown.expired && (
        <View style={styles.urgency}>
          <Text style={styles.urgencyText}>
            ⚠️ El Plan Mundialista está disponible solo hasta el 19 de julio.
            Después de esa fecha, solo estará disponible el plan mensual.
          </Text>
        </View>
      )}

      <Pressable
        style={[styles.ctaButton, loading && styles.ctaDisabled]}
        onPress={handleUpgrade}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.ctaText}>
            {PLANS[selectedPlan].buttonText}
          </Text>
        )}
      </Pressable>

      <Text style={styles.faqTitle}>Preguntas frecuentes</Text>
      {FAQ_ITEMS.map((item, i) => (
        <Pressable
          key={i}
          style={styles.faqItem}
          onPress={() => setExpandedFAQ(expandedFAQ === i ? null : i)}
        >
          <View style={styles.faqHeader}>
            <Text style={styles.faqQuestion}>{item.q}</Text>
            <Text style={styles.faqChevron}>{expandedFAQ === i ? '▲' : '▼'}</Text>
          </View>
          {expandedFAQ === i && (
            <Text style={styles.faqAnswer}>{item.a}</Text>
          )}
        </Pressable>
      ))}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function CountdownBox({ value, unit }: { value: string; unit: string }) {
  return (
    <View style={styles.cdBox}>
      <Text style={styles.cdNum}>{value}</Text>
      <Text style={styles.cdUnit}>{unit}</Text>
    </View>
  );
}

type PlanCardProps = {
  plan: typeof PLANS.monthly | typeof PLANS.quarterly;
  selected: boolean;
  onSelect: () => void;
};

function PlanCard({ plan, selected, onSelect }: PlanCardProps) {
  return (
    <Pressable
      style={[styles.planCard, selected && styles.planCardSelected]}
      onPress={onSelect}
    >
      {(plan.badgeSave || plan.badgeEvent) && (
        <View style={styles.badgeRow}>
          {plan.badgeSave && (
            <View style={styles.badgeSave}>
              <Text style={styles.badgeSaveText}>{plan.badgeSave}</Text>
            </View>
          )}
          {plan.badgeEvent && (
            <View style={styles.badgeEvent}>
              <Text style={styles.badgeEventText}>{plan.badgeEvent}</Text>
            </View>
          )}
        </View>
      )}
      <View style={styles.planBody}>
        <View style={styles.planLeft}>
          <View style={[styles.radio, selected && styles.radioOn]}>
            {selected && <View style={styles.radioDot} />}
          </View>
          <View style={styles.planInfo}>
            <Text style={styles.planTitle}>{plan.title}</Text>
            <Text style={styles.planSubtitle}>{plan.subtitle}</Text>
            {plan.detail && <Text style={styles.planDetail}>{plan.detail}</Text>}
          </View>
        </View>
        <View style={styles.planRight}>
          <Text style={styles.planPrice}>{plan.price}</Text>
          <Text style={styles.planPeriod}>{plan.period}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { paddingHorizontal: 20, paddingTop: 16 },

  header: { marginBottom: 20 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#1A1A1A', marginBottom: 6 },
  headerSubtitle: { fontSize: 14, color: '#666666', lineHeight: 21 },

  featureTable: { borderRadius: 10, borderWidth: 1, borderColor: '#E0E0E0', overflow: 'hidden', marginBottom: 22 },
  featureHead: { flexDirection: 'row', backgroundColor: '#5B2D8E', paddingVertical: 9, paddingHorizontal: 10 },
  featureHeadCell: { fontSize: 11, fontWeight: '600', color: '#FFFFFF' },
  featureRow: { flexDirection: 'row', paddingVertical: 9, paddingHorizontal: 10, borderBottomWidth: 0.5, borderBottomColor: '#EBEBEB' },
  featureRowAlt: { backgroundColor: '#FAFAFA' },
  featureCell: { fontSize: 11, color: '#333' },
  fLabel: { flex: 2 },
  fValue: { flex: 1, textAlign: 'center', color: '#999' },
  fValueP: { flex: 1, textAlign: 'center', color: '#F57C20', fontWeight: '600' },
  freeHighlight: { color: '#D32F2F', fontWeight: '600' },

  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#1A1A1A', marginBottom: 10 },

  countdownWrap: { backgroundColor: '#5B2D8E', borderRadius: 12, padding: 14, marginBottom: 14, alignItems: 'center' },
  countdownLabel: { fontSize: 12, color: '#D4C6EE', marginBottom: 8 },
  countdownBoxes: { flexDirection: 'row', gap: 8 },
  cdBox: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, paddingVertical: 8, width: 62, alignItems: 'center' },
  cdNum: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  cdUnit: { fontSize: 10, color: '#B8A5D8', marginTop: 2 },

  planCard: { borderWidth: 1.5, borderColor: '#E0E0E0', borderRadius: 12, padding: 14, marginBottom: 10, backgroundColor: '#FFFFFF' },
  planCardSelected: { borderColor: '#F57C20', borderWidth: 2, backgroundColor: '#FFF8F2' },
  badgeRow: { flexDirection: 'row', gap: 5, marginBottom: 7 },
  badgeSave: { backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5 },
  badgeSaveText: { fontSize: 10, fontWeight: '600', color: '#2E7D32' },
  badgeEvent: { backgroundColor: '#5B2D8E', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5 },
  badgeEventText: { fontSize: 10, fontWeight: '600', color: '#FFFFFF' },
  planBody: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planLeft: { flexDirection: 'row', alignItems: 'flex-start', flex: 1, gap: 10 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#CCC', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  radioOn: { borderColor: '#F57C20' },
  radioDot: { width: 11, height: 11, borderRadius: 5.5, backgroundColor: '#F57C20' },
  planInfo: { flex: 1 },
  planTitle: { fontSize: 14, fontWeight: '600', color: '#1A1A1A' },
  planSubtitle: { fontSize: 11, color: '#666', marginTop: 1 },
  planDetail: { fontSize: 11, color: '#999', marginTop: 2 },
  planRight: { alignItems: 'flex-end' },
  planPrice: { fontSize: 19, fontWeight: '700', color: '#1A1A1A' },
  planPeriod: { fontSize: 11, color: '#999' },

  urgency: { backgroundColor: '#FFF3E0', borderLeftWidth: 4, borderLeftColor: '#F57C20', borderRadius: 0, padding: 10, marginVertical: 14 },
  urgencyText: { fontSize: 11, color: '#E65100', lineHeight: 18 },

  ctaButton: { backgroundColor: '#F57C20', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginBottom: 22 },
  ctaDisabled: { opacity: 0.7 },
  ctaText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },

  faqTitle: { fontSize: 14, fontWeight: '600', color: '#1A1A1A', marginBottom: 6 },
  faqItem: { borderBottomWidth: 0.5, borderBottomColor: '#E8E8E8', paddingVertical: 11 },
  faqHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  faqQuestion: { fontSize: 12, fontWeight: '500', color: '#333', flex: 1, paddingRight: 12 },
  faqChevron: { fontSize: 12, color: '#999' },
  faqAnswer: { fontSize: 11, color: '#666', lineHeight: 18, marginTop: 6 },
});
