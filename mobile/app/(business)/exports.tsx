/**
 * Business · Exportar reportes PDF (EXPORT-01, EXPORT-02).
 *
 * Flujo:
 *  1. Usuario elige tipo (coupons | loyalty | redemptions) y rango opcional.
 *  2. Tap "Generar" → POST /api/exports/pdf devuelve `export_id` en estado
 *     pending. Iniciamos polling cada 3s a GET /api/exports/:id.
 *  3. Cuando status === 'completed', mostramos `file_url` con botón "Abrir
 *     PDF" (Linking) y caducidad. Si 'failed', mostramos `error_message`.
 *
 * Reglas:
 *  - Solo Premium. 429 EXPORT_IN_PROGRESS si ya hay otra en curso.
 *  - Mensajes LITERALES.
 *  - El polling se cancela al desmontar o al completarse.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { ScreenContainer } from '@/components/ScreenContainer';
import { TextField } from '@/components/TextField';
import { Button } from '@/components/Button';
import {
  getExport,
  requestExport,
  type ExportStatusResponse,
  type ExportType,
} from '@/services/exportsApi';
import { extractApiError } from '@/services/api';
import { colors, fontSize, radii, spacing } from '@/utils/theme';

const TYPE_OPTIONS: { value: ExportType; label: string; hint: string }[] = [
  { value: 'coupons_report', label: 'Cupones', hint: 'Listado y desempeño por cupón' },
  { value: 'loyalty_report', label: 'Lealtad', hint: 'Sellos asignados y recompensas canjeadas' },
  { value: 'redemptions_report', label: 'Redenciones', hint: 'Histórico de canjes con monto y fecha' },
];

const POLL_INTERVAL_MS = 3000;

export default function BusinessExports() {
  const [type, setType] = useState<ExportType>('coupons_report');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportInfo, setExportInfo] = useState<ExportStatusResponse | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const startPolling = useCallback(
    (id: number) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const r = await getExport(id);
          setExportInfo(r);
          if (r.status === 'completed' || r.status === 'failed') {
            stopPolling();
          }
        } catch (e) {
          setError(extractApiError(e).error);
          stopPolling();
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling]
  );

  const onRequest = useCallback(async () => {
    setError(null);
    if (dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
      setError('Fecha "desde" inválida (YYYY-MM-DD).');
      return;
    }
    if (dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      setError('Fecha "hasta" inválida (YYYY-MM-DD).');
      return;
    }
    setRequesting(true);
    try {
      const r = await requestExport({
        type,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setExportInfo({
        export_id: r.export_id,
        type,
        status: r.status,
        created_at: new Date().toISOString(),
        completed_at: null,
      });
      startPolling(r.export_id);
    } catch (e) {
      setError(extractApiError(e).error);
    } finally {
      setRequesting(false);
    }
  }, [type, dateFrom, dateTo, startPolling]);

  const onOpenPdf = useCallback(async () => {
    if (!exportInfo?.file_url) return;
    try {
      await Linking.openURL(exportInfo.file_url);
    } catch {
      Alert.alert('No se pudo abrir', 'Copia y pega el enlace en tu navegador.');
    }
  }, [exportInfo?.file_url]);

  return (
    <ScreenContainer>
      <Text style={styles.title}>Exportar reportes</Text>
      <Text style={styles.sub}>
        Genera un PDF con métricas detalladas. La generación puede tardar unos segundos.
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Tipo de reporte</Text>
        <View style={styles.typeRow}>
          {TYPE_OPTIONS.map((o) => {
            const active = o.value === type;
            return (
              <Pressable
                key={o.value}
                onPress={() => setType(o.value)}
                style={[
                  styles.typeCard,
                  { borderColor: active ? colors.primary : colors.border },
                ]}
              >
                <Text style={[styles.typeLabel, active && { color: colors.primary }]}>
                  {o.label}
                </Text>
                <Text style={styles.typeHint}>{o.hint}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Rango (opcional)</Text>
        <TextField
          label="Desde (YYYY-MM-DD)"
          placeholder="2026-01-01"
          value={dateFrom}
          onChangeText={setDateFrom}
          autoCapitalize="none"
        />
        <TextField
          label="Hasta (YYYY-MM-DD)"
          placeholder="2026-04-30"
          value={dateTo}
          onChangeText={setDateTo}
          autoCapitalize="none"
        />
      </View>

      {!!error && <Text style={styles.error}>{error}</Text>}

      <Button
        title="Generar reporte"
        onPress={onRequest}
        loading={requesting}
        disabled={!!exportInfo && (exportInfo.status === 'pending' || exportInfo.status === 'processing')}
      />

      {!!exportInfo && (
        <View
          style={[
            styles.resultCard,
            { borderColor: borderForStatus(exportInfo.status) },
          ]}
        >
          <Text style={styles.resultTitle}>
            Reporte #{exportInfo.export_id}
          </Text>
          <Text style={styles.resultStatus}>
            Estado: <Text style={{ color: borderForStatus(exportInfo.status), fontWeight: '700' }}>
              {labelForStatus(exportInfo.status)}
            </Text>
          </Text>
          {exportInfo.status === 'completed' && exportInfo.file_url && (
            <>
              <Text style={styles.resultText}>
                Disponible hasta: {exportInfo.expires_at ? new Date(exportInfo.expires_at).toLocaleString() : '—'}
              </Text>
              <Button title="Abrir PDF" variant="secondary" onPress={onOpenPdf} />
            </>
          )}
          {exportInfo.status === 'failed' && (
            <Text style={styles.errorInline}>
              {exportInfo.error_message || 'Error al generar el reporte.'}
            </Text>
          )}
          {(exportInfo.status === 'pending' || exportInfo.status === 'processing') && (
            <Text style={styles.resultText}>
              Estamos generando tu PDF, esta pantalla se actualiza sola.
            </Text>
          )}
        </View>
      )}
    </ScreenContainer>
  );
}

function labelForStatus(s: ExportStatusResponse['status']): string {
  switch (s) {
    case 'pending': return 'En cola';
    case 'processing': return 'Procesando';
    case 'completed': return 'Listo';
    case 'failed': return 'Falló';
  }
}

function borderForStatus(s: ExportStatusResponse['status']): string {
  switch (s) {
    case 'pending':
    case 'processing': return colors.warning;
    case 'completed': return colors.success;
    case 'failed': return colors.danger;
  }
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  sub: { color: colors.textMuted, fontSize: fontSize.sm },
  section: { gap: spacing.sm, marginTop: spacing.md },
  sectionTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  typeCard: {
    flexBasis: '48%', flexGrow: 1,
    padding: spacing.md, borderRadius: radii.md, borderWidth: 2,
    backgroundColor: colors.bgLight, gap: spacing.xs,
  },
  typeLabel: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  typeHint: { fontSize: fontSize.xs, color: colors.textMuted },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center', marginTop: spacing.sm },
  errorInline: { color: colors.danger, fontSize: fontSize.sm },
  resultCard: {
    marginTop: spacing.lg, padding: spacing.lg,
    backgroundColor: colors.bgLight, borderRadius: radii.lg,
    borderWidth: 2, gap: spacing.sm,
  },
  resultTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  resultStatus: { fontSize: fontSize.sm, color: colors.textPrimary },
  resultText: { fontSize: fontSize.sm, color: colors.textMuted },
});
