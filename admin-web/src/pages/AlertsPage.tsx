import { useCallback, useEffect, useState } from 'react';
import {
  listAlerts,
  resolveAlert,
  type AdminAlert,
  type AlertResolveAction,
  type AlertSeverity,
  type AlertStatus,
  type BusinessesPagination,
} from '@/services/adminApi';
import { extractApiError } from '@/services/api';
import { formatDate } from '@/utils/format';

const STATUS_OPTIONS: { value: AlertStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'open', label: 'Abiertas' },
  { value: 'resolved', label: 'Resueltas' },
];

const SEVERITY_OPTIONS: { value: AlertSeverity | 'all'; label: string }[] = [
  { value: 'all', label: 'Cualquier severidad' },
  { value: 'low', label: 'Baja' },
  { value: 'medium', label: 'Media' },
  { value: 'high', label: 'Alta' },
];

const SEVERITY_BADGE: Record<AlertSeverity, string> = {
  low: 'bg-bg-muted text-ink',
  medium: 'bg-warning text-white',
  high: 'bg-danger text-white',
};

const STATUS_BADGE: Record<AlertStatus, string> = {
  open: 'bg-warning text-white',
  resolved: 'bg-success text-white',
};

const ACTIONS: { value: AlertResolveAction; label: string; danger?: boolean }[] = [
  { value: 'ignore', label: 'Ignorar' },
  { value: 'block_consumer', label: 'Bloquear consumidor', danger: true },
  { value: 'suspend_business', label: 'Suspender negocio', danger: true },
];

export function AlertsPage() {
  const [statusFilter, setStatusFilter] = useState<AlertStatus | 'all'>('open');
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | 'all'>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminAlert[]>([]);
  const [pag, setPag] = useState<BusinessesPagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pending, setPending] = useState<
    | { alert: AdminAlert; action: AlertResolveAction; notes: string }
    | null
  >(null);
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await listAlerts({
        status: statusFilter,
        severity: severityFilter,
        page,
      });
      setData(r.alerts);
      setPag(r.pagination);
    } catch (e) {
      setError(extractApiError(e).error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, severityFilter, page]);

  useEffect(() => { void load(); }, [load]);

  const onResolve = async () => {
    if (!pending) return;
    setActionBusy(true);
    try {
      await resolveAlert(pending.alert.alert_id, pending.action, pending.notes || undefined);
      setPending(null);
      await load();
    } catch (e) {
      setError(extractApiError(e).error);
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl text-ink">Alertas antifraude</h1>
        <p className="text-sm text-ink-muted">
          Reportes generados automáticamente o por negocios. Cada resolución registra una acción auditable.
        </p>
      </header>

      <div className="card flex flex-col md:flex-row md:items-end gap-3">
        <div>
          <label className="label">Estado</label>
          <select
            className="input"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as AlertStatus | 'all'); setPage(1); }}
          >
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Severidad</label>
          <select
            className="input"
            value={severityFilter}
            onChange={(e) => { setSeverityFilter(e.target.value as AlertSeverity | 'all'); setPage(1); }}
          >
            {SEVERITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <button onClick={load} className="btn-ghost" disabled={loading}>
          {loading ? 'Cargando…' : 'Refrescar'}
        </button>
      </div>

      {error && <p className="text-danger">{error}</p>}

      <div className="space-y-3">
        {data.map((a) => (
          <div key={a.alert_id} className="card">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SEVERITY_BADGE[a.severity]}`}>
                    {a.severity}
                  </span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[a.status]}`}>
                    {a.status}
                  </span>
                  <span className="text-xs text-ink-muted">#{a.alert_id} · {a.type}</span>
                </div>
                <p className="text-sm text-ink">{a.description}</p>
                <ContextLine ctx={a.context} />
                <p className="text-xs text-ink-muted mt-1">
                  Creada: {formatDate(a.created_at)}{a.resolved_at ? ` · Resuelta: ${formatDate(a.resolved_at)}` : ''}
                </p>
              </div>
              {a.status === 'open' && (
                <div className="flex flex-col gap-1 min-w-[140px]">
                  {ACTIONS.map((act) => (
                    <button
                      key={act.value}
                      className={act.danger ? 'btn-danger text-xs' : 'btn-ghost text-xs'}
                      onClick={() => setPending({ alert: a, action: act.value, notes: '' })}
                    >
                      {act.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {data.length === 0 && !loading && (
          <p className="text-center text-ink-muted py-8">Sin alertas con esos filtros.</p>
        )}
      </div>

      {pag && pag.total_pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-ink-muted">
            Página {pag.page} de {pag.total_pages} · {pag.total} alertas
          </p>
          <div className="space-x-2">
            <button className="btn-ghost text-xs" disabled={pag.page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
            <button className="btn-ghost text-xs" disabled={pag.page >= pag.total_pages} onClick={() => setPage((p) => p + 1)}>Siguiente</button>
          </div>
        </div>
      )}

      {pending && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4">
          <div className="bg-bg rounded-lg w-full max-w-md p-6 space-y-3">
            <h2 className="font-display text-xl text-ink">Resolver alerta #{pending.alert.alert_id}</h2>
            <p className="text-sm text-ink">
              Acción: <strong>{pending.action}</strong>
            </p>
            <p className="text-sm text-ink-muted">{pending.alert.description}</p>
            <div>
              <label className="label">Notas (opcional)</label>
              <textarea
                className="input min-h-[80px]"
                value={pending.notes}
                onChange={(e) => setPending({ ...pending, notes: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setPending(null)}>Cancelar</button>
              <button
                className={pending.action === 'ignore' ? 'btn-primary' : 'btn-danger'}
                onClick={onResolve}
                disabled={actionBusy}
              >
                {actionBusy ? 'Aplicando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ContextLine({ ctx }: { ctx: AdminAlert['context'] }) {
  const parts: string[] = [];
  if (ctx.business_name) parts.push(`Negocio: ${ctx.business_name} (#${ctx.business_id})`);
  if (ctx.consumer_name) parts.push(`Consumidor: ${ctx.consumer_name} (#${ctx.consumer_id})`);
  if (ctx.coupon_id) parts.push(`Cupón #${ctx.coupon_id}`);
  if (parts.length === 0) return null;
  return <p className="text-xs text-ink-muted mt-1">{parts.join(' · ')}</p>;
}
