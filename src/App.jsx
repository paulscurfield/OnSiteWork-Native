import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { Toaster as SonnerToaster } from 'sonner';
import { CompanyProvider, useCompany } from '@/lib/companyContext';

// Page imports
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Profile from './pages/Profile';
import Jobs from './pages/Jobs';
import ClockIn from './pages/ClockIn';
import Timesheets from './pages/Timesheets';
import Messages from './pages/Messages';
import Equipment from './pages/Equipment';
import Admin from './pages/Admin';
import Leave from './pages/Leave';
import Calendar from './pages/Calendar';
import TeamMap from './pages/TeamMap';
import SitePhotos from './pages/SitePhotos';
import PreStart from './pages/PreStart';
import Login from './pages/Login';
import InviteAccept from './pages/InviteAccept';

const LoadingScreen = ({ message = 'Loading OnSite...' }) => (
  <div className="fixed inset-0 flex items-center justify-center bg-background">
    <div className="flex flex-col items-center gap-4">
      <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      <p className="text-muted-foreground text-sm">{message}</p>
    </div>
  </div>
);

const CompanyAccessScreen = ({ title, description, detail, onRetry, onLogout }) => (
  <div className="fixed inset-0 flex items-center justify-center bg-background px-8">
    <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
      <div>
        <h1 className="mb-2 text-2xl font-black text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
        {detail && <p className="mt-2 text-xs text-muted-foreground">{detail}</p>}
      </div>
      <div className="flex w-full flex-col gap-3">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="w-full rounded-2xl bg-primary py-3 text-sm font-black text-primary-foreground transition-all active:scale-95"
          >
            Try Again
          </button>
        )}
        <button
          type="button"
          onClick={onLogout}
          className="w-full rounded-2xl bg-secondary py-3 text-sm font-black text-foreground transition-all active:scale-95"
        >
          Sign Out
        </button>
      </div>
    </div>
  </div>
);

const PrivateRouteGate = () => {
  const { isAuthenticated, isLoadingAuth, isLoadingPublicSettings, authError, logout } = useAuth();
  const { company, loadingCompany, companyError, companyStatus, refreshCompany } = useCompany();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (authError && authError.type !== 'auth_required') {
    return (
      <CompanyAccessScreen
        title="Sign In Unavailable"
        description="Authentication could not be confirmed."
        detail={authError.message}
        onRetry={() => window.location.reload()}
        onLogout={() => logout()}
      />
    );
  }

  if (loadingCompany) {
    return <LoadingScreen message="Loading company access..." />;
  }

  if (!company) {
    if (companyStatus === 'no_company_membership') {
      return (
        <CompanyAccessScreen
          title="No Company Access Yet"
          description="Your account is signed in, but it is not connected to a company yet."
          detail="Ask an owner or admin to add you, then try again."
          onRetry={refreshCompany}
          onLogout={() => logout()}
        />
      );
    }

    return (
      <CompanyAccessScreen
        title="Company Access Unavailable"
        description="Company access could not be resolved."
        detail={companyError}
        onRetry={refreshCompany}
        onLogout={() => logout()}
      />
    );
  }

  return <Outlet />;
};

const AppRoutes = () => (
  <Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/invite/accept" element={<InviteAccept />} />
    <Route element={<PrivateRouteGate />}>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/clockin/:jobId" element={<ClockIn />} />
        <Route path="/timesheets" element={<Timesheets />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/equipment" element={<Equipment />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/leave" element={<Leave />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/team-map" element={<TeamMap />} />
        <Route path="/site-photos" element={<SitePhotos />} />
        <Route path="/prestart" element={<PreStart />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Route>
  </Routes>
);

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <CompanyProvider>
            <AppRoutes />
          </CompanyProvider>
        </Router>
        <Toaster />
        <SonnerToaster
          theme="dark"
          position="top-center"
          toastOptions={{
            style: {
              background: 'hsl(220 14% 11%)',
              border: '1px solid hsl(220 12% 18%)',
              color: 'hsl(210 20% 95%)',
            },
          }}
        />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
