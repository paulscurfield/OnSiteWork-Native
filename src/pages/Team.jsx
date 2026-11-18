import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Mail, Phone, ShieldCheck, UserRound, UsersRound } from 'lucide-react';
import { onsiteApi } from '@/api/supabase/adapter';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/companyContext';
import { createTeamScopeKey, resolveTeamReadScope } from '@/lib/team-access';

const roleLabel = role => {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  return 'Worker';
};

export default function Team() {
  const { user } = useAuth();
  const { company, membership } = useCompany();
  const requestIdRef = useRef(0);
  const [members, setMembers] = useState([]);
  const [resultScopeKey, setResultScopeKey] = useState(null);
  const [directoryState, setDirectoryState] = useState('loading');
  const teamScope = useMemo(() => resolveTeamReadScope({
    userId: user?.id,
    company,
    membership,
  }), [company, membership, user?.id]);
  const teamScopeKey = createTeamScopeKey(teamScope);
  const hasCurrentResult = Boolean(teamScopeKey) && resultScopeKey === teamScopeKey;
  const visibleMembers = hasCurrentResult ? members : [];
  const visibleState = !teamScope
    ? 'unavailable'
    : hasCurrentResult
      ? directoryState
      : 'loading';
  const directorySummary = !teamScope
    ? 'An active company workspace is required.'
    : visibleState === 'ready' || visibleState === 'empty'
      ? `${visibleMembers.length} team ${visibleMembers.length === 1 ? 'member' : 'members'} · Signed-in role: ${roleLabel(teamScope.role)}`
      : `Signed-in role: ${roleLabel(teamScope.role)}`;

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setMembers([]);
    setResultScopeKey(null);

    if (!teamScope || !teamScopeKey) {
      setDirectoryState('unavailable');
      return;
    }

    setDirectoryState('loading');
    onsiteApi.teamDirectory.list(teamScope.companyId)
      .then(result => {
        if (requestId !== requestIdRef.current) return;
        setMembers(result);
        setResultScopeKey(teamScopeKey);
        setDirectoryState(result.length === 0 ? 'empty' : 'ready');
      })
      .catch(error => {
        if (requestId !== requestIdRef.current) return;
        console.error('Failed to load Supabase Team directory:', error);
        setMembers([]);
        setResultScopeKey(teamScopeKey);
        setDirectoryState('error');
      });

    return () => {
      requestIdRef.current += 1;
    };
  }, [teamScope, teamScopeKey]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-5 pb-24 pt-10 sm:px-8 lg:pb-12 lg:pt-16">
        <header className="rounded-3xl border border-border bg-card p-6 sm:p-8">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <UsersRound className="h-7 w-7" aria-hidden="true" />
          </span>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-primary">{teamScope?.companyName || 'Company workspace'}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Team</h1>
          <p className="mt-2 text-sm text-muted-foreground">{directorySummary}</p>
        </header>

        {visibleState === 'loading' ? (
          <section className="mt-5 grid gap-4 sm:grid-cols-2" aria-label="Loading team directory" aria-busy="true">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="h-40 animate-pulse rounded-3xl border border-border bg-card" />
            ))}
          </section>
        ) : visibleState === 'unavailable' ? (
          <DirectoryNotice
            icon={ShieldCheck}
            title="Team directory unavailable"
            message="Sign in and select an authorised company workspace before viewing its Team directory."
          />
        ) : visibleState === 'error' ? (
          <DirectoryNotice
            icon={AlertTriangle}
            title="Team directory unavailable"
            message="The company Team directory could not be loaded. No previous-company records are displayed."
            alert
          />
        ) : visibleState === 'empty' ? (
          <DirectoryNotice
            icon={UsersRound}
            title="No team members found"
            message="The authorised company directory returned no current membership records."
          />
        ) : (
          <section className="mt-5 grid gap-4 sm:grid-cols-2" aria-label="Company team directory">
            {visibleMembers.map(member => (
              <article key={member.member_id} className="rounded-3xl border border-border bg-card p-6">
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <UserRound className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-black">{member.full_name || 'Name unavailable'}</h2>
                      {member.user_id === teamScope.userId && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">You</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs font-bold uppercase tracking-[0.15em] text-primary">{roleLabel(member.role)}</p>
                  </div>
                </div>

                <div className="mt-5 space-y-3 border-t border-border pt-4 text-sm text-muted-foreground">
                  {member.email && (
                    <p className="flex items-center gap-3 break-all">
                      <Mail className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      {member.email}
                    </p>
                  )}
                  {member.phone && (
                    <p className="flex items-center gap-3">
                      <Phone className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      {member.phone}
                    </p>
                  )}
                  {!member.email && !member.phone && (
                    <p>Contact details not provided.</p>
                  )}
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

const DirectoryNotice = ({ icon: Icon, title, message, alert = false }) => (
  <section
    className={`mt-5 rounded-3xl border bg-card p-8 text-center ${alert ? 'border-amber-400/20' : 'border-border'}`}
    role={alert ? 'alert' : 'status'}
  >
    <Icon className={`mx-auto h-9 w-9 ${alert ? 'text-amber-400' : 'text-primary'}`} aria-hidden="true" />
    <h2 className="mt-4 text-xl font-black">{title}</h2>
    <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{message}</p>
  </section>
);
