import { useEffect, useState } from 'react';
import { fetchMetrics, type AdminMetrics } from '@/services/adminApi';
import { extractApiError } from '@/services/api';
import { formatCurrencyMXN, formatDate, formatPercent } from '@/utils/format';

export function DashboardPage() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const m = await fetchMetrics();
      setMetrics(m);
    } catch (e) {
      setError(extractApiError(e).error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-ink">Métricas globales</h1>
          <p className="text-sm text-ink-muted">
            Snapshot operativo de Cuponiko. Actualiza cada vez que entres aquí.
          </p>
        </div>
        <button onClick={load} className="btn-ghost" disabled={loading}>
          {loading ? 'Cargando…' : 'Actualizar'}
        </button>
      </header>

      {error && <p className="text-danger">{error}</p>}

      {metrics && (
        <>
          <p className="text-xs text-ink-muted">
            Generado: {formatDate(metrics.generated_at)}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MetricCard
              label="Usuarios activos"
              value={metrics.active_users.toLocaleString('es-MX')}
              hint="Consumers + business con sesión activa"
            />
            <MetricCard
              label="Negocios activos"
              value={metrics.active_businesses.toLocaleString('es-MX')}
              hint={`${metrics.premium_count} en plan Premium`}
            />
            <MetricCard
              label="MRR estimado"
              value={formatCurrencyMXN(metrics.mrr)}
              hint="Premium count × precio mensual"
              accent="secondary"
            />
            <MetricCard
              label="Cupones creados"
              value={metrics.coupons_created.toLocaleString('es-MX')}
              hint="Total histórico"
            />
            <MetricCard
              label="Cupones canjeados"
              value={metrics.coupons_redeemed.toLocaleString('es-MX')}
              hint="Total histórico"
            />
            <MetricCard
              label="Tasa de canje"
              value={formatPercent(metrics.redemption_rate)}
              hint="Canjeados / creados"
              accent={metrics.redemption_rate > 0.2 ? 'success' : undefined}
            />
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({
  label, value, hint, accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: 'success' | 'secondary';
}) {
  const accentClass =
    accent === 'success' ? 'text-success'
      : accent === 'secondary' ? 'text-secondary'
        : 'text-ink';
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-ink-muted font-semibold">{label}</p>
      <p className={`mt-2 font-display text-3xl ${accentClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
