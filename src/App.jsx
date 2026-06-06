import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import { Toaster as SonnerToaster } from 'sonner';
import { CompanyProvider, useCompany } from '@/lib/companyContext';
import { base44 } from '@/api/base44Client';

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
import TeamMap from './pages/TeamMap';
import SitePhotos from './pages/SitePhotos';
import Onboarding from './pages/Onboarding';
import PreStart from './pages/PreStart';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, user } = useAuth();
  const { company, loadingCompany, setCompany } = useCompany();

  if (isLoadingPublicSettings || isLoadingAuth || loadingCompany) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
          <p className="text-muted-foreground text-sm">Loading OnSite...</p>
        </div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      return (
        <div className="fixed inset-0 flex items-center justify-center bg-background px-8">
          <div className="flex flex-col items-center gap-6 text-center">
            <div className="text-5xl">🏗️</div>
            <div>
              <h1 className="text-2xl font-black text-foreground mb-1">OnSite Timesheet</h1>
              <p className="text-muted-foreground text-sm">You need to log in to continue.</p>
            </div>
            <button
              onClick={() => base44.auth.redirectToLogin(window.location.origin + '/')}
              className="w-full max-w-xs py-4 rounded-2xl font-black text-lg"
              style={{ backgroundColor: '#10B981', color: '#000' }}
            >
              Tap to Login
            </button>
          </div>
        </div>
      );
    }
  }

  // Only the original app creator (paulscurfield@gmail.com or paul.scurfield@icloud.com) should see onboarding
  // Invited admins should never see onboarding — they join via invite like workers
  const isAppOwner = user?.email === 'paulscurfield@gmail.com' || user?.email === 'paul.scurfield@icloud.com';
  if (!company && user?.role === 'admin' && isAppOwner) {
    return <Onboarding onComplete={setCompany} />;
  }

  // Worker has no company yet — show a friendly waiting screen instead of flickering
  if (!company && user?.role !== 'admin') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background px-8">
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="text-5xl">🏗️</div>
          <div>
            <h1 className="text-2xl font-black text-foreground mb-1">Almost There!</h1>
            <p className="text-muted-foreground text-sm">Your account is being set up.</p>
            <p className="text-muted-foreground text-sm mt-1">Please wait a moment and try refreshing the page.</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="w-full max-w-xs py-4 rounded-2xl font-black text-lg"
            style={{ backgroundColor: '#10B981', color: '#000' }}
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <Routes>
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
        <Route path="/team-map" element={<TeamMap />} />
        <Route path="/site-photos" element={<SitePhotos />} />
        <Route path="/prestart" element={<PreStart />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <CompanyProvider>
            <AuthenticatedApp />
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