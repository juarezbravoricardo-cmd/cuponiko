/**
 * Cliente API mobile para exportación de reportes PDF (EXPORT-01, EXPORT-02) — Fase 3.5.
 *
 * Flujo: requestExport(...) devuelve `export_id` en estado pending; la app debe
 * hacer polling periódico a `getExport(id)` hasta que `status === 'completed'`
 * (file_url disponible) o `'failed'` (error_message).
 *
 * Solo Premium. Una sola exportación activa por negocio (429 EXPORT_IN_PROGRESS).
 */

import { api } from './api';

export type ExportType = 'coupons_report' | 'loyalty_report' | 'redemptions_report';
export type ExportStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface RequestExportInput {
  type: ExportType;
  date_from?: string; // YYYY-MM-DD
  date_to?: string;   // YYYY-MM-DD
}

export interface RequestExportResponse {
  export_id: number;
  status: ExportStatus;
  message: string;
}

export interface ExportStatusResponse {
  export_id: number;
  type: ExportType;
  status: ExportStatus;
  created_at: string;
  completed_at: string | null;
  file_url?: string;
  expires_at?: string;
  error_message?: string;
}

// ────────────────────────────────────────────────────────────
// EXPORT-01: POST /api/exports/pdf
// ────────────────────────────────────────────────────────────
export async function requestExport(
  input: RequestExportInput
): Promise<RequestExportResponse> {
  const r = await api.post('/api/exports/pdf', input);
  return r.data.data as RequestExportResponse;
}

// ────────────────────────────────────────────────────────────
// EXPORT-02: GET /api/exports/:id
// ────────────────────────────────────────────────────────────
export async function getExport(id: number): Promise<ExportStatusResponse> {
  const r = await api.get(`/api/exports/${id}`);
  return r.data.data as ExportStatusResponse;
}
