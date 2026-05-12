import { useCallback, useEffect, useState } from 'react';
import {
  activateBusiness,
  listBusinesses,
  suspendBusiness,
  type AdminBusiness,
  type BusinessesPagination,
  type BusinessStatus,
} from '@/services/adminApi';
import { extractApiError } from '@/services/api';
import { formatDate } from '@/utils/format';

const STATUS_OPTIONS: { value: BusinessStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'suspended', label: 'Suspendidos' },
  { value: 'inactive', label: 'Inactivos' },
];

const STATUS_BADGE: Record<BusinessStatus, string> = {
  active: 'bg-success text-white',
  suspended: 'bg-danger text-white',
  inactive: 'bg-ink-muted text-white',
};

export function BusinessesPage() {
  const [statusFilter, setStatusFilter] = useState<BusinessStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminBusiness[]>([]);
  const [pag, setPag] = useState<BusinessesPagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal de confirmación suspend/activate.
  const [pending, setPending] = useState<
    | { kind: 'suspend' | 'activate'; biz: AdminBusiness; reason?: string }
    | null
  >(null);
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await listBusinesses({
        status: statusFilter,
        search: search.trim() || undefined,
        page,
      });
      setData(r.businesses);
      setPag(r.pagination);
    } catch (e) {
      setError(extractApiError(e).error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, page]);

  useEffect(() => { void load(); }, [load]);

  const onConfirmAction = async () => {
    if (!pending) return;
    setActionBusy(true);
    try {
      if (pending.kind === 'suspend') {
        await suspendBusiness(pending.biz.business_id, pending.reason);
      } else {
        await activateBusiness(pending.biz.business_id);
      }
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
        <h1 className="font-display text-3xl text-ink">Negocios</h1>
        <p className="text-sm text-ink-muted">
          Lista y moderación de cuentas business. Suspender pausa cupones y notifica a consumidores con cupón activo.
        </p>
      </header>

      <div className="card flex flex-col md:flex-row md:items-end gap-3">
        <div className="flex-1">
          <label className="label" htmlFor="search">Buscar</label>
          <input
            id="search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Nombre, correo, categoría…"
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="status">Estado</label>
          <select
            id="status"
            className="input"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as BusinessStatus | 'all'); setPage(1); }}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <button onClick={load} className="btn-ghost" disabled={loading}>
          {loading ? 'Cargando…' : 'Refrescar'}
        </button>
      </div>

      {error && <p className="text-danger">{error}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="py-2 pr-3">Negocio</th>
              <th className="py-2 pr-3">Dueño</th>
              <th className="py-2 pr-3">Estado</th>
              <th className="py-2 pr-3">Plan</th>
              <th className="py-2 pr-3">Cupones activos</th>
              <th className="py-2 pr-3">Alta</th>
              <th className="py-2 pr-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {data.map((b) => (
              <tr key={b.business_id} className="border-t border-bg-border align-top">
                <td className="py-3 pr-3">
                  <p className="font-semibold text-ink">{b.business_name}</p>
                  <p className="text-xs text-ink-muted">{b.category}</p>
                  {b.display_address && (
                    <p className="text-xs text-ink-muted mt-1">{b.display_address}</p>
                  )}
                </td>
                <td className="py-3 pr-3">
                  <p className="text-ink">{b.owner.full_name}</p>
                  <p className="text-xs text-ink-muted">{b.owner.email}</p>
                </td>
                <td className="py-3 pr-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[b.status]}`}>
                    {b.status}
                  </span>
                </td>
                <td className="py-3 pr-3 capitalize">{b.plan}</td>
                <td className="py-3 pr-3">{b.active_coupons_count}</td>
                <td className="py-3 pr-3 text-xs text-ink-muted">{formatDate(b.created_at)}</td>
                <td className="py-3 pr-0 text-right space-x-2">
                  {b.status !== 'suspended' && (
                    <button
                      className="btn-danger px-3 py-1 text-xs"
                      onClick={() => setPending({ kind: 'suspend', biz: b, reason: '' })}
                    >
                      Suspender
                    </button>
                  )}
                  {b.status === 'suspended' && (
                    <button
                      className="btn-primary px-3 py-1 text-xs"
                      onClick={() => setPending({ kind: 'activate', biz: b })}
                    >
                      Activar
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {data.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-ink-muted">
                  Sin resultados con esos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pag && pag.total_pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-ink-muted">
            Página {pag.page} de {pag.total_pages} · {pag.total} resultados
          </p>
          <div className="space-x-2">
            <button
              className="btn-ghost text-xs"
              disabled={pag.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </button>
            <button
              className="btn-ghost text-xs"
              disabled={pag.page >= pag.total_pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </button>
          </div>
        </div>
      )}

      {pending && (
        <ConfirmModal
          title={pending.kind === 'suspend' ? 'Suspender negocio' : 'Reactivar negocio'}
          confirmLabel={pending.kind === 'suspend' ? 'Suspender' : 'Activar'}
          confirmVariant={pending.kind === 'suspend' ? 'danger' : 'primary'}
          busy={actionBusy}
          onCancel={() => setPending(null)}
          onConfirm={onConfirmAction}
        >
          <p className="text-sm text-ink">
            {pending.kind === 'suspend'
              ? `Vas a suspender "${pending.biz.business_name}". Sus cupones activos serán pausados y se notificará a los consumidores con cupón en cartera.`
              : `Vas a reactivar "${pending.biz.business_name}". Sus cupones permanecen pausados hasta que el dueño los reactive manualmente.`}
          </p>
          {pending.kind === 'suspend' && (
            <div className="mt-3">
              <label className="label" htmlFor="reason">Motivo (opcional)</label>
              <textarea
                id="reason"
                className="input min-h-[80px]"
                value={pending.reason || ''}
                onChange={(e) => setPending({ ...pending, reason: e.target.value })}
              />
            </div>
          )}
        </ConfirmModal>
      )}
    </div>
  );
}

function ConfirmModal({
  title,
  confirmLabel,
  confirmVariant,
  busy,
  onCancel,
  onConfirm,
  children,
}: {
  title: string;
  confirmLabel: string;
  confirmVariant: 'danger' | 'primary';
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4">
      <div className="bg-bg rounded-lg w-full max-w-md p-6 space-y-3">
        <h2 className="font-display text-xl text-ink">{title}</h2>
        {children}
        <div className="flex justify-end gap-2 pt-3">
          <button onClick={onCancel} className="btn-ghost">Cancelar</button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={confirmVariant === 'danger' ? 'btn-danger' : 'btn-primary'}
          >
            {busy ? 'Aplicando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
