import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth, type PageKey } from "@/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Sales from "@/pages/Sales";
import FuelManagement from "@/pages/FuelManagement";
import Expenses from "@/pages/Expenses";
import Reports from "@/pages/Reports";
import Users from "@/pages/Users";
import Payroll from "@/pages/Payroll";
import Branches from "@/pages/Branches";
import Pumps from "@/pages/Pumps";
import Tanks from "@/pages/Tanks";
import Reconciliation from "@/pages/Reconciliation";

import NotFound from "@/pages/NotFound";
import ChangePassword from "@/pages/ChangePassword";
import { ConfirmDeleteProvider } from "@/hooks/useConfirmDelete";
import { OfflineSyncProvider } from "@/hooks/useOfflineSync";

const queryClient = new QueryClient();

function ProtectedRoute({ children, page }: { children: React.ReactNode; page: PageKey }) {
  const { user, loading, canAccessPage, mustChangePassword } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-accent border-t-transparent rounded-full" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (mustChangePassword) return <ChangePassword />;
  if (!canAccessPage(page)) return <Navigate to="/sales" replace />;
  return <DashboardLayout>{children}</DashboardLayout>;
}

function AppRoutes() {
  const { user, loading, canAccessPage, mustChangePassword } = useAuth();
  if (loading) return null;

  const landing: string = user
    ? (canAccessPage("dashboard") ? "/" : canAccessPage("sales") ? "/sales" : "/sales")
    : "/login";

  if (user && mustChangePassword) return <ChangePassword />;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={landing} replace /> : <Login />} />
      <Route path="/" element={<ProtectedRoute page="dashboard"><Dashboard /></ProtectedRoute>} />
      <Route path="/sales" element={<ProtectedRoute page="sales"><Sales /></ProtectedRoute>} />
      <Route path="/fuel" element={<ProtectedRoute page="fuel"><FuelManagement /></ProtectedRoute>} />
      <Route path="/expenses" element={<ProtectedRoute page="expenses"><Expenses /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute page="reports"><Reports /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute page="users"><Users /></ProtectedRoute>} />
      <Route path="/payroll" element={<ProtectedRoute page="payroll"><Payroll /></ProtectedRoute>} />
      <Route path="/branches" element={<ProtectedRoute page="branches"><Branches /></ProtectedRoute>} />
      <Route path="/pumps" element={<ProtectedRoute page="pumps"><Pumps /></ProtectedRoute>} />
      <Route path="/tanks" element={<ProtectedRoute page="tanks"><Tanks /></ProtectedRoute>} />
      <Route path="/reconciliation" element={<ProtectedRoute page="reconciliation"><Reconciliation /></ProtectedRoute>} />
      
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <OfflineSyncProvider>
            <ConfirmDeleteProvider>
              <AppRoutes />
            </ConfirmDeleteProvider>
          </OfflineSyncProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
