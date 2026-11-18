import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Building2, ChevronLeft, Mail, Phone, ShieldCheck, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { onsiteApi } from '@/api/supabase/adapter';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/companyContext';
import {
  createProfileIdentityKey,
  isProfilePermissionError,
  profileRoleLabel,
  resolveProfileWorkspace,
} from '@/lib/profile-access';

const verificationLabels = {
  verified: 'Verified',
  unverified: 'Not verified',
  unknown: 'Verification unknown',
  unavailable: 'Not provided',
};

const verificationStyles = {
  verified: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  unverified: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  unknown: 'border-border bg-secondary text-muted-foreground',
  unavailable: 'border-border bg-secondary text-muted-foreground',
};

export default function Profile() {
  const { user } = useAuth();
  const { company, membership, loadingCompany, companyError } = useCompany();
  const profileRequestIdRef = useRef(0);
  const avatarRequestIdRef = useRef(0);
  const [profile, setProfile] = useState(null);
  const [profileResultKey, setProfileResultKey] = useState(null);
  const [profileState, setProfileState] = useState('loading');
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [avatarResultKey, setAvatarResultKey] = useState(null);

  const identityKey = createProfileIdentityKey(user?.id);
  const workspace = useMemo(() => resolveProfileWorkspace({
    userId: identityKey,
    company,
    membership,
  }), [company, identityKey, membership]);
  const hasCurrentProfile = Boolean(identityKey) && profileResultKey === identityKey;
  const visibleProfile = hasCurrentProfile ? profile : null;
  const visibleProfileState = !identityKey
    ? 'unauthenticated'
    : hasCurrentProfile
      ? profileState
      : 'loading';
  const expectedAvatarKey = identityKey && visibleProfile?.avatar_path
    ? `${identityKey}:${visibleProfile.avatar_path}`
    : null;
  const visibleAvatarUrl = expectedAvatarKey && avatarResultKey === expectedAvatarKey
    ? avatarUrl
    : null;

  useEffect(() => {
    const requestId = profileRequestIdRef.current + 1;
    profileRequestIdRef.current = requestId;
    avatarRequestIdRef.current += 1;
    setProfile(null);
    setProfileResultKey(null);
    setAvatarUrl(null);
    setAvatarResultKey(null);

    if (!identityKey) {
      setProfileState('unauthenticated');
      return;
    }

    setProfileState('loading');
    onsiteApi.profileRead.get(identityKey)
      .then(result => {
        if (requestId !== profileRequestIdRef.current) return;
        setProfile(result);
        setProfileResultKey(identityKey);
        setProfileState(result ? 'ready' : 'missing');
      })
      .catch(error => {
        if (requestId !== profileRequestIdRef.current) return;
        console.error('Failed to load Supabase self profile:', error);
        setProfile(null);
        setProfileResultKey(identityKey);
        setProfileState(isProfilePermissionError(error) ? 'denied' : 'error');
      });

    return () => { profileRequestIdRef.current += 1; };
  }, [identityKey]);

  useEffect(() => {
    const requestId = avatarRequestIdRef.current + 1;
    avatarRequestIdRef.current = requestId;
    setAvatarUrl(null);
    setAvatarResultKey(null);

    if (!expectedAvatarKey || !visibleProfile?.avatar_path) return;

    onsiteApi.auth.getMyAvatarSignedUrl(visibleProfile.avatar_path)
      .then(signedUrl => {
        if (requestId !== avatarRequestIdRef.current) return;
        setAvatarUrl(signedUrl);
        setAvatarResultKey(expectedAvatarKey);
      })
      .catch(error => {
        if (requestId !== avatarRequestIdRef.current) return;
        console.warn('Profile avatar preview could not be loaded:', error);
        setAvatarUrl(null);
        setAvatarResultKey(expectedAvatarKey);
      });

    return () => { avatarRequestIdRef.current += 1; };
  }, [expectedAvatarKey, visibleProfile?.avatar_path]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-5 pb-24 pt-10 sm:px-8 lg:pb-12 lg:pt-16">
        <header className="flex items-center gap-4">
          <Link to="/" aria-label="Back to dashboard" className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Account identity</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight">My Profile</h1>
          </div>
        </header>

        {visibleProfileState === 'loading' ? (
          <ProfileLoading />
        ) : visibleProfileState === 'unauthenticated' ? (
          <ProfileNotice icon={ShieldCheck} title="Profile unavailable" message="Sign in before viewing your profile." />
        ) : visibleProfileState === 'missing' ? (
          <ProfileNotice icon={UserRound} title="Profile not found" message="No profile record is available for the authenticated account." />
        ) : visibleProfileState === 'denied' ? (
          <ProfileNotice alert icon={ShieldCheck} title="Profile access denied" message="The authenticated account is not permitted to read this profile." />
        ) : visibleProfileState === 'error' ? (
          <ProfileNotice alert icon={AlertTriangle} title="Profile unavailable" message="Your profile could not be loaded. No previous account information is displayed." />
        ) : (
          <>
            <section className="mt-6 rounded-3xl border border-border bg-card p-6 text-center sm:p-8" aria-label="Authenticated user profile">
              {visibleAvatarUrl ? (
                <img src={visibleAvatarUrl} alt="Profile avatar" className="mx-auto h-24 w-24 rounded-full border-2 border-primary/40 object-cover" />
              ) : (
                <span className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border-2 border-primary/40 bg-primary/10 text-3xl font-black text-primary">
                  {visibleProfile.full_name?.charAt(0)?.toUpperCase() || '?'}
                </span>
              )}
              <h2 className="mt-5 text-2xl font-black">{visibleProfile.full_name || 'Name not provided'}</h2>
              <p className="mt-2 text-sm text-muted-foreground">Authenticated account profile</p>
            </section>

            <section className="mt-5 space-y-4" aria-label="Profile contact details">
              <ContactField icon={Mail} label="Email" value={visibleProfile.email} verification={visibleProfile.email_verification} />
              <ContactField icon={Phone} label="Phone" value={visibleProfile.phone} verification={visibleProfile.phone_verification} />
            </section>
          </>
        )}

        <WorkspaceCard
          loading={loadingCompany}
          error={companyError}
          workspace={workspace}
          authenticated={Boolean(identityKey)}
        />
      </div>
    </div>
  );
}

const ContactField = ({ icon: Icon, label, value, verification }) => (
  <article className="rounded-2xl border border-border bg-card p-5">
    <div className="flex items-start gap-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className="mt-1 break-all font-semibold">{value || 'Not provided'}</p>
        <span className={`mt-3 inline-block rounded-full border px-2.5 py-1 text-xs font-bold ${verificationStyles[verification]}`}>
          {verificationLabels[verification]}
        </span>
      </div>
    </div>
  </article>
);

const WorkspaceCard = ({ loading, error, workspace, authenticated }) => {
  let title = 'No active workspace';
  let detail = authenticated ? 'Select an authorised company workspace to view your current role.' : 'Sign in to resolve a company workspace.';

  if (loading) {
    title = 'Resolving active workspace';
    detail = 'Previous company-role information is hidden while the workspace changes.';
  } else if (error) {
    title = 'Workspace unavailable';
    detail = 'The current company and membership role could not be confirmed.';
  } else if (workspace) {
    title = workspace.companyName || 'Current company';
    detail = `${profileRoleLabel(workspace.role)} in this active workspace`;
  }

  return (
    <section className="mt-5 rounded-3xl border border-border bg-card p-6" aria-label="Active company membership">
      <div className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Building2 className="h-6 w-6" aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Active company membership</p>
          <h2 className="mt-2 text-xl font-black">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
        </div>
      </div>
    </section>
  );
};

const ProfileLoading = () => (
  <section className="mt-6 space-y-4" aria-label="Loading profile" aria-busy="true">
    <div className="h-52 animate-pulse rounded-3xl border border-border bg-card" />
    <div className="h-28 animate-pulse rounded-2xl border border-border bg-card" />
    <div className="h-28 animate-pulse rounded-2xl border border-border bg-card" />
  </section>
);

const ProfileNotice = ({ icon: Icon, title, message, alert = false }) => (
  <section className={`mt-6 rounded-3xl border bg-card p-8 text-center ${alert ? 'border-amber-400/20' : 'border-border'}`} role={alert ? 'alert' : 'status'}>
    <Icon className={`mx-auto h-9 w-9 ${alert ? 'text-amber-400' : 'text-primary'}`} aria-hidden="true" />
    <h2 className="mt-4 text-xl font-black">{title}</h2>
    <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{message}</p>
  </section>
);
