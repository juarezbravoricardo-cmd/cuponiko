import { useState } from 'react';
import { blockUser } from '@/services/adminApi';
import { extractApiError } from '@/services/api';

/**
 * UsersPage — bloqueo manual de consumidores por ID.
 *
 * Razón del diseño: el backend solo expone `PATCH /api/admin/users/:id/block`
 * (no hay listado completo de usuarios). Este flujo está pensado para
 * ejecutar acciones puntuales tras una alerta o reporte interno.
 */
export function UsersPage() {
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [history, setHistory] = useState<{ user_id: number; reason: string; at: string }[]>([]);

  const id = Number(userId);
  const validId = Number.isInteger(id) && id > 0;

  const onBlock = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await blockUser(id, reason || undefined);
      setHistory((h) => [
        { user_id: r.user_id, reason: reason || '—', at: new Date().toISOString() },
        ...h,
      ]);
      setUserId('');
      setReason('');
      setConfirming(false);
    } catch (e) {
      setError(extractApiError(e).error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl text-ink">Bloqueo de consumidores</h1>
        <p className="text-sm text-ink-muted">
          Bloquea cuentas <code>consumer</code> por su ID interno. Acción inmediata e irreversible vía esta vista (revertir requiere acceso directo a DB).
        </p>
      </header>

      <div className="card max-w-xl space-y-4">
        <div>
          <label className="label" htmlFor="user_id">ID de usuario</label>
          <input
            id="user_id"
            className="input"
            inputMode="numeric"
            value={userId}
            onChange={(e) => setUserId(e.target.value.replace(/\D/g, ''))}
            placeholder="Ej. 4291"
          />
        </div>
        <div>
          <label className="label" htmlFor="reason">Motivo (opcional)</label>
          <textarea
            id="reason"
            className="input min-h-[100px]"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Razón del bloqueo (queda registrado en activity_logs)"
          />
        </div>

        {error && <p className="text-danger text-sm">{error}</p>}

        <div className="flex gap-2">
          <button
            className="btn-danger"
            disabled={!validId || busy}
            onClick={() => setConfirming(true)}
          >
            Bloquear usuario
          </button>
        </div>
      </div>

      {history.length > 0 && (
        <div className="card max-w-xl">
          <h2 className="font-semibold text-ink mb-2">Bloqueos en esta sesión</h2>
          <ul className="divide-y divide-bg-border text-sm">
            {history.map((h, i) => (
              <li key={`${h.user_id}-${i}`} className="py-2">
                Usuario #{h.user_id} — {new Date(h.at).toLocaleString('es-MX')}
                {h.reason && h.reason !== '—' && (
                  <p className="text-xs text-ink-muted">"{h.reason}"</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4">
          <div className="bg-bg rounded-lg w-full max-w-md p-6 space-y-3">
            <h2 className="font-display text-xl text-ink">Confirmar bloqueo</h2>
            <p className="text-sm text-ink">
              ¿Bloquear al usuario <strong>#{id}</strong>? Esto invalida sus sesiones y push token. Solo aplica a cuentas con rol consumer.
            </p>
            {reason && (
              <p className="text-xs text-ink-muted">Motivo: {reason}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setConfirming(false)}>Cancelar</button>
              <button className="btn-danger" onClick={onBlock} disabled={busy}>
                {busy ? 'Aplicando…' : 'Bloquear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
