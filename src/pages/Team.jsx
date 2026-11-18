import { LockKeyhole, UsersRound } from 'lucide-react';
import { useCompany } from '@/lib/companyContext';

const roleLabel = role => {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  return 'Worker';
};

export default function Team() {
  const { company, membership } = useCompany();
  const canAdministerTeam = membership?.role === 'owner' || membership?.role === 'admin';

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-5 pb-24 pt-10 sm:px-8 lg:pb-12 lg:pt-16">
        <header className="rounded-3xl border border-border bg-card p-6 sm:p-8">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <UsersRound className="h-7 w-7" aria-hidden="true" />
          </span>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-primary">{company?.name || 'Company workspace'}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Team</h1>
          <p className="mt-2 text-sm text-muted-foreground">Signed-in role: {roleLabel(membership?.role)}</p>
        </header>

        <section className="mt-5 rounded-3xl border border-border bg-card p-6 sm:p-8">
          <LockKeyhole className="h-8 w-8 text-primary" aria-hidden="true" />
          <h2 className="mt-5 text-xl font-black">Team workspace integration pending</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {canAdministerTeam
              ? 'Team administration remains in the existing protected administration page until its backend contracts are reviewed for this workspace.'
              : 'Team administration is restricted to company owners and admins. No privileged controls are available from this worker view.'}
          </p>
          <p className="mt-5 rounded-2xl border border-dashed border-border bg-secondary/40 p-5 text-sm text-muted-foreground">
            No team directory or sample staff records are displayed while backend integration is unavailable.
          </p>
        </section>
      </div>
    </div>
  );
}
