import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Loading } from './components/common';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import SearchPage from './pages/SearchPage';

// Everyday screens load with the shell; the rest are split into separate chunks for slow links.
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage'));
const ItemDetailPage = lazy(() => import('./pages/ItemDetailPage'));
const InventoryPage = lazy(() => import('./pages/InventoryPage'));
const StockFormPage = lazy(() => import('./pages/StockFormPage'));
const DocumentsPage = lazy(() => import('./pages/DocumentsPage'));
const DocumentDetailPage = lazy(() => import('./pages/DocumentDetailPage'));
const ItemsMasterPage = lazy(() => import('./pages/ItemsMasterPage'));
const CategoriesPage = lazy(() => import('./pages/CategoriesUnitsPages').then((m) => ({ default: m.CategoriesPage })));
const UnitsPage = lazy(() => import('./pages/CategoriesUnitsPages').then((m) => ({ default: m.UnitsPage })));
const SubstationsPage = lazy(() => import('./pages/SubstationsPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const RolesPage = lazy(() => import('./pages/RolesPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const ReconciliationPage = lazy(() => import('./pages/ReconciliationPage'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (me.mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  return <>{children}</>;
}

const page = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<DashboardPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="change-password" element={page(<ChangePasswordPage />)} />
        <Route path="items/:id" element={page(<ItemDetailPage />)} />
        <Route path="inventory" element={page(<InventoryPage />)} />
        <Route path="stock/new/:type" element={page(<StockFormPage />)} />
        <Route path="stock/documents" element={page(<DocumentsPage />)} />
        <Route path="stock/documents/:id" element={page(<DocumentDetailPage />)} />
        <Route path="master/items" element={page(<ItemsMasterPage />)} />
        <Route path="master/categories" element={page(<CategoriesPage />)} />
        <Route path="master/units" element={page(<UnitsPage />)} />
        <Route path="master/substations" element={page(<SubstationsPage />)} />
        <Route path="admin/users" element={page(<UsersPage />)} />
        <Route path="admin/roles" element={page(<RolesPage />)} />
        <Route path="admin/reconciliation" element={page(<ReconciliationPage />)} />
        <Route path="audit" element={page(<AuditPage />)} />
        <Route path="reports" element={page(<ReportsPage />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
