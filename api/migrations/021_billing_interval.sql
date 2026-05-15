-- Migración 021: Agregar columna billing_interval a businesses
-- Soporta el Plan Mundialista trimestral además del plan mensual.

ALTER TABLE businesses 
  ADD COLUMN billing_interval TEXT DEFAULT 'monthly'
  CHECK (billing_interval IN ('monthly', 'quarterly'));

COMMENT ON COLUMN businesses.billing_interval IS 
  'Ciclo de facturación del plan Premium. monthly = $399 MXN/mes, quarterly = $1,047 MXN/trimestre';
