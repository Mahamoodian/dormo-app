import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import { Spinner } from './components/ui.jsx';
import Login from './pages/auth/Login.jsx';
import ChangePassword from './pages/auth/ChangePassword.jsx';
import Account from './pages/auth/Account.jsx';
import AdminReports from './pages/admin/AdminReports.jsx';
import AdminUsers from './pages/admin/AdminUsers.jsx';
import AdminUserView from './pages/admin/AdminUserView.jsx';
import Dashboard from './pages/owner/Dashboard.jsx';
import Beds from './pages/owner/Beds.jsx';
import Properties from './pages/owner/Properties.jsx';
import Clients from './pages/owner/Clients.jsx';
import ClientDetail from './pages/owner/ClientDetail.jsx';
import Receivables from './pages/owner/Receivables.jsx';
import Expenses from './pages/owner/Expenses.jsx';

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner className="min-h-screen items-center" />;
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>;
  if (user.must_change_password) return <ChangePassword forced />;

  if (user.role === 'super_admin') {
    return (
      <Routes>
        <Route element={<Layout admin />}>
          <Route path="/admin" element={<AdminReports />} />
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/users/:id" element={<AdminUserView />} />
          <Route path="/account" element={<Account />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Routes>
    );
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/beds" element={<Beds />} />
        <Route path="/properties" element={<Properties />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/clients/:id" element={<ClientDetail />} />
        <Route path="/receivables" element={<Receivables />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/account" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
