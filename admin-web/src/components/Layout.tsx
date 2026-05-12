import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { tokenStore } from '@/services/api';
import { logout } from '@/services/authApi';

const NAV = [
  { to: '/', label: 'Dashboard', exact: true },
  { to: '/businesses', label: 'Negocios' },
  { to: '/alerts', label: 'Alertas' },
  { to: '/users', label: 'Bloqueo de usuarios' },
];

export function Layout() {
  const nav = useNavigate();

  const onLogout = async () => {
    await logout();
    nav('/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 bg-bg border-r border-bg-border flex flex-col">
        <div className="px-6 py-5 border-b border-bg-border">
          <p className="font-display text-xl tracking-tight text-primary">Cuponiko</p>
          <p className="text-xs text-ink-muted mt-0.5">Panel administrativo</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.exact}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-md text-sm font-medium ${
                  isActive
                    ? 'bg-primary text-white'
                    : 'text-ink hover:bg-bg-muted'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-bg-border">
          <button onClick={onLogout} className="btn-ghost w-full">Cerrar sesión</button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!tokenStore.access) {
    window.location.href = '/login';
    return null;
  }
  return <>{children}</>;
}
