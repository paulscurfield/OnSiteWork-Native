import { AlertTriangle, ArrowLeft, BriefcaseBusiness, DatabaseZap } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import ModuleIcon from '@/components/navigation/ModuleIcon';
import { useCompany } from '@/lib/companyContext';
import {
  createWorkspaceJobContextKey,
  getJobFirstModule,
  getJobSelectorPath,
  isValidJobIdentifier,
} from '@/navigation/dashboard-modules';

const InvalidRoute = ({ message, moduleKey }) => {
  const module = getJobFirstModule(moduleKey);
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center px-6 py-12">
      <section className="w-full rounded-3xl border border-amber-400/20 bg-amber-400/5 p-8 text-center" role="alert">
        <AlertTriangle className="mx-auto h-9 w-9 text-amber-400" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-black">Job context unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{message}</p>
        <Link
          to={module ? getJobSelectorPath(module.key) : '/'}
          className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {module ? 'Choose a job' : 'Return to dashboard'}
        </Link>
      </section>
    </div>
  );
};

export default function JobModuleRecords() {
  const { company } = useCompany();
  const { jobId, moduleKey } = useParams();
  const module = getJobFirstModule(moduleKey);

  if (!module) {
    return <InvalidRoute message="This module is not part of the approved job-first workspace." moduleKey={moduleKey} />;
  }
  if (!isValidJobIdentifier(jobId)) {
    return <InvalidRoute message="The URL does not contain a valid job identifier. Choose the job again from the company-scoped list." moduleKey={moduleKey} />;
  }

  const contextKey = createWorkspaceJobContextKey(company?.id, moduleKey, jobId);
  if (!contextKey) {
    return <InvalidRoute message="The active company and job context could not be established safely." moduleKey={moduleKey} />;
  }

  return (
    <div key={contextKey} className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-5 pb-24 pt-8 sm:px-8 lg:pb-12 lg:pt-12">
        <Link
          to={getJobSelectorPath(module.key)}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to {module.label} jobs
        </Link>

        <header className="mt-5 rounded-3xl border border-border bg-card p-6 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ModuleIcon name={module.icon} className="h-7 w-7" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Job workspace</p>
              <h1 className="mt-1 text-3xl font-black tracking-tight">{module.label}</h1>
              <p className="mt-2 truncate text-sm text-muted-foreground">{company.name}</p>
            </div>
          </div>
        </header>

        <section className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]" aria-label={`${module.label} job status`}>
          <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
            <DatabaseZap className="h-8 w-8 text-primary" aria-hidden="true" />
            <h2 className="mt-5 text-xl font-black">Backend connection unavailable</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {module.label} records for this job are not connected during W02-A. No records have been requested, cached or fabricated on this page.
            </p>
            <div className="mt-6 rounded-2xl border border-dashed border-border bg-secondary/40 p-5">
              <p className="text-sm font-bold">No records to display offline</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Secure company and job validation will be completed through the approved backend contract in a later checkpoint.</p>
            </div>
          </div>

          <aside className="rounded-3xl border border-border bg-card p-6" aria-label="Selected job context">
            <div className="flex items-center gap-3">
              <BriefcaseBusiness className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="font-black">Selected job</h2>
            </div>
            <p className="mt-4 break-all rounded-xl bg-secondary p-3 font-mono text-xs text-muted-foreground">{jobId.toLowerCase()}</p>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">A route identifier is not treated as authorisation. The backend must independently verify company and job access.</p>
          </aside>
        </section>
      </div>
    </div>
  );
}
