import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '@/services/authApi';
import { extractApiError } from '@/services/api';

export function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await login(email.trim().toLowerCase(), password);
      if (r.user.role !== 'admin') {
        setError('Esta cuenta no tiene acceso al panel administrativo.');
        return;
      }
      nav('/', { replace: true });
    } catch (err) {
      setError(extractApiError(err).error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-muted px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-bg rounded-lg border border-bg-border p-6 space-y-4"
      >
        <div className="text-center">
          <p className="font-display text-2xl text-primary">Cuponiko</p>
          <p className="text-sm text-ink-muted">Panel administrativo</p>
        </div>

        <div>
          <label className="label" htmlFor="email">Correo</label>
          <input
            id="email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="password">Contraseña</label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {!!error && <p className="text-danger text-sm">{error}</p>}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>

        <p className="text-xs text-ink-muted text-center">
          Solo cuentas con rol <code>admin</code> tienen acceso.
        </p>
      </form>
    </div>
  );
}
