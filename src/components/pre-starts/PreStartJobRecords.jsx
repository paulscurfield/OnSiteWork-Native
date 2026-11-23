import { DatabaseZap, ShieldCheck } from 'lucide-react';
import { resolvePreStartJobScope } from '@/lib/pre-start-access';

export default function PreStartJobRecords({ jobScope, job }) {
  const scope = resolvePreStartJobScope({ jobScope, job });

  return (
    <section className="min-w-0 rounded-3xl border border-border bg-card p-6 sm:p-8" aria-label="Pre-Start records">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            <p className="text-xs font-black uppercase tracking-[0.16em]">Read-only safety records</p>
          </div>
          <h2 className="mt-3 text-xl font-black">Pre-Starts</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {scope ? scope.jobName : 'Verified job access required'}
          </p>
        </div>
        <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-primary">View only</span>
      </div>

      <div className="mt-6 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5" role="status">
        <DatabaseZap className="h-7 w-7 text-amber-400" aria-hidden="true" />
        <h3 className="mt-4 font-black">Job-specific Pre-Start history unavailable</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {scope
            ? 'This job is verified, but the approved backend history interface cannot filter inspections by Job. No company-wide inspections have been requested or shown as Job records.'
            : 'An authenticated company membership and verified Job are required.'}
        </p>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Owner and Admin users can inspect equipment-scoped Pre-Start history from an eligible machinery or vehicle record. Inspections with no Job remain correctly unassigned.
        </p>
      </div>
    </section>
  );
}
