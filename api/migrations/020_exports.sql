-- ============================================================
-- M-020: exports — exportaciones PDF asíncronas solicitadas por negocios
-- Definida en cuponiko_contratos_api_v2.md (Fase 3.5).
-- Esta migración DEBE ejecutarse ANTES de implementar EXPORT-01 y EXPORT-02.
-- ============================================================

CREATE TABLE IF NOT EXISTS exports (
  id BIGSERIAL PRIMARY KEY,
  business_id BIGINT NOT NULL REFERENCES businesses(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  type VARCHAR(50) NOT NULL DEFAULT 'coupons_report',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  file_path VARCHAR(500),
  file_url VARCHAR(1000),
  expires_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_exports_business ON exports(business_id);
CREATE INDEX IF NOT EXISTS idx_exports_status ON exports(status);

COMMENT ON TABLE exports IS 'Exportaciones PDF asíncronas solicitadas por negocios';
