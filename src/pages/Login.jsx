import { useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';

export default function Login() {
  const { isAuthenticated, isLoadingAuth, requestMagicLink } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmedEmail = email.trim();

    if (!trimmedEmail || sendingRef.current) return;

    sendingRef.current = true;
    setSending(true);

    try {
      await requestMagicLink(trimmedEmail);
      setSent(true);
      toast.success('Check your email for a sign-in link.');
    } catch (error) {
      console.error('Sign-in link request failed:', error);
      toast.error(error?.message || 'Could not send sign-in link.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-sm flex-col justify-center">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-black">OnSite Timesheet</h1>
          <p className="text-sm text-muted-foreground">Enter your work email to receive a secure sign-in link.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-foreground">Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary"
              placeholder="you@example.com"
            />
          </label>

          <button
            type="submit"
            disabled={sending || !email.trim()}
            className="w-full rounded-2xl bg-primary py-4 text-base font-black text-primary-foreground transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? 'Sending...' : 'Email Me a Sign-In Link'}
          </button>
        </form>

        {sent && (
          <p className="mt-5 rounded-2xl bg-secondary px-4 py-3 text-sm text-muted-foreground">
            If your account is active, a sign-in link has been sent to that email address.
          </p>
        )}
      </div>
    </main>
  );
}
