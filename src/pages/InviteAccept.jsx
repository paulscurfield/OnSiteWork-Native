import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { onsiteApi } from '@/api/supabase/adapter';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/companyContext';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN_PATTERN = /^[0-9a-f]{48}$/;
const acceptanceRequests = new Map();

const parseInvitationParams = (search) => {
  const params = new URLSearchParams(search);
  const invitationId = params.get('invitation_id')?.trim() || '';
  const token = params.get('token')?.trim() || '';

  if (!UUID_PATTERN.test(invitationId) || !TOKEN_PATTERN.test(token)) {
    return {
      valid: false,
      invitationId: '',
      token: '',
      key: '',
    };
  }

  return {
    valid: true,
    invitationId,
    token,
    key: `${invitationId}:${token}`,
  };
};

const acceptInvitationOnce = (invitationId, token) => {
  const existingRequest = acceptanceRequests.get(invitationId);
  if (existingRequest) return existingRequest;

  const request = onsiteApi.tables.invitations
    .accept({
      invitation_id: invitationId,
      token,
    })
    .finally(() => {
      acceptanceRequests.delete(invitationId);
    });

  acceptanceRequests.set(invitationId, request);
  return request;
};

export default function InviteAccept() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isLoadingAuth, logout } = useAuth();
  const { refreshCompany } = useCompany();
  const invitation = useMemo(() => parseInvitationParams(location.search), [location.search]);

  const [status, setStatus] = useState('idle');
  const [accepted, setAccepted] = useState(false);
  const mountedRef = useRef(false);
  const acceptingRef = useRef(false);
  const acceptedRef = useRef(false);
  const autoAttemptedKeyRef = useRef('');

  const clearInvitationUrl = useCallback(() => {
    const params = new URLSearchParams(location.search);
    params.delete('invitation_id');
    params.delete('token');

    navigate(
      {
        pathname: location.pathname,
        search: params.toString() ? `?${params.toString()}` : '',
      },
      { replace: true }
    );
  }, [location.pathname, location.search, navigate]);

  const acceptInvitation = useCallback(
    async ({ manualRetry = false } = {}) => {
      if (!invitation.valid || acceptingRef.current || acceptedRef.current) return;
      if (!manualRetry && autoAttemptedKeyRef.current === invitation.key) return;

      acceptingRef.current = true;
      autoAttemptedKeyRef.current = invitation.key;
      setStatus('accepting');

      try {
        await acceptInvitationOnce(invitation.invitationId, invitation.token);

        acceptedRef.current = true;
        if (!mountedRef.current) return;

        setAccepted(true);
        setStatus('refreshing');
        clearInvitationUrl();

        try {
          await refreshCompany();
          if (!mountedRef.current) return;
          navigate('/', { replace: true });
        } catch (_error) {
          if (!mountedRef.current) return;
          setStatus('refresh_failed');
        }
      } catch (_error) {
        if (!mountedRef.current) return;
        setStatus('failed');
      } finally {
        acceptingRef.current = false;
      }
    },
    [clearInvitationUrl, invitation, navigate, refreshCompany]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (isLoadingAuth || !isAuthenticated || !invitation.valid || acceptedRef.current) return;
    acceptInvitation();
  }, [acceptInvitation, invitation.valid, isAuthenticated, isLoadingAuth]);

  const handleRefreshCompany = async () => {
    if (acceptingRef.current) return;
    acceptingRef.current = true;
    setStatus('refreshing');

    try {
      await refreshCompany();
      if (!mountedRef.current) return;
      navigate('/', { replace: true });
    } catch (_error) {
      if (!mountedRef.current) return;
      setStatus('refresh_failed');
    } finally {
      acceptingRef.current = false;
    }
  };

  const handleLogout = () => {
    logout();
  };

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
      </div>
    );
  }

  const isBusy = status === 'accepting' || status === 'refreshing';
  const title = accepted ? 'Invitation Accepted' : 'Company Invitation';

  let description = 'Checking your invitation...';
  let detail = '';

  if (!invitation.valid) {
    description = 'This invitation link is invalid or incomplete.';
    detail = 'Ask an owner or admin to send a new invitation.';
  } else if (!isAuthenticated) {
    description =
      'This invitation link needs to be opened from the invitation email so your account can be securely signed in.';
    detail = 'You can sign in, but you may need to open the original invitation email again afterward.';
  } else if (status === 'accepting') {
    description = 'Accepting your invitation...';
  } else if (status === 'refreshing') {
    description = 'Invitation accepted. Loading your company access...';
  } else if (status === 'refresh_failed') {
    description = 'Invitation accepted, but company access could not be refreshed.';
    detail = 'Try refreshing company access, or continue to the app.';
  } else if (status === 'failed') {
    description = 'This invitation could not be accepted.';
    detail = 'It may be invalid, expired, revoked, or for a different account.';
  }

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-sm flex-col justify-center">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-black">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
          {detail && <p className="mt-2 text-xs text-muted-foreground">{detail}</p>}
        </div>

        {isBusy && (
          <div className="mb-5 flex justify-center rounded-2xl bg-secondary px-4 py-6">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
          </div>
        )}

        <div className="space-y-3">
          {!invitation.valid && (
            <Link
              to="/login"
              className="block w-full rounded-2xl bg-primary py-4 text-center text-base font-black text-primary-foreground transition-all active:scale-95"
            >
              Go to Sign In
            </Link>
          )}

          {invitation.valid && !isAuthenticated && (
            <Link
              to="/login"
              className="block w-full rounded-2xl bg-primary py-4 text-center text-base font-black text-primary-foreground transition-all active:scale-95"
            >
              Sign In
            </Link>
          )}

          {status === 'failed' && (
            <>
              <button
                type="button"
                onClick={() => acceptInvitation({ manualRetry: true })}
                disabled={isBusy}
                className="w-full rounded-2xl bg-primary py-4 text-base font-black text-primary-foreground transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Retry Acceptance
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="w-full rounded-2xl bg-secondary py-4 text-base font-black text-foreground transition-all active:scale-95"
              >
                Sign Out
              </button>
            </>
          )}

          {status === 'refresh_failed' && (
            <>
              <button
                type="button"
                onClick={handleRefreshCompany}
                disabled={isBusy}
                className="w-full rounded-2xl bg-primary py-4 text-base font-black text-primary-foreground transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={() => navigate('/', { replace: true })}
                className="w-full rounded-2xl bg-secondary py-4 text-base font-black text-foreground transition-all active:scale-95"
              >
                Continue
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
