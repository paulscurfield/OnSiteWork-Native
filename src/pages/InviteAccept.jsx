import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

export default function InviteAccept() {
  const { isAuthenticated, isLoadingAuth } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-sm flex-col justify-center">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-black">Company Invitation</h1>
          <p className="text-sm text-muted-foreground">
            Invitation acceptance is not available in this version yet.
          </p>
        </div>

        <div className="rounded-2xl bg-secondary px-4 py-4 text-sm text-muted-foreground">
          {isAuthenticated
            ? 'Your sign-in session is active. An owner or admin still needs to finish company access for your account.'
            : 'Sign in with the email address that received the invitation, then ask an owner or admin to confirm company access.'}
        </div>

        <Link
          to={isAuthenticated ? '/' : '/login'}
          className="mt-5 block w-full rounded-2xl bg-primary py-4 text-center text-base font-black text-primary-foreground transition-all active:scale-95"
        >
          {isAuthenticated ? 'Go to App' : 'Sign In'}
        </Link>
      </div>
    </main>
  );
}
