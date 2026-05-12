import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout, RequireAuth } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { BusinessesPage } from './pages/BusinessesPage';
import { AlertsPage } from './pages/AlertsPage';
import { UsersPage } from './pages/UsersPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/businesses" element={<BusinessesPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/users" element={<UsersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
