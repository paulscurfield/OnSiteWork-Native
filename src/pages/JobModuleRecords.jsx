import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, BriefcaseBusiness, DatabaseZap } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { onsiteApi } from '@/api/supabase/adapter';
import ModuleIcon from '@/components/navigation/ModuleIcon';
import PurchaseOrderRecords from '@/components/purchase-orders/PurchaseOrderRecords';
import SiteDiaryRecords from '@/components/site-diaries/SiteDiaryRecords';
import ToolboxTalkRecords from '@/components/toolbox-talks/ToolboxTalkRecords';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/companyContext';
import { createJobScopeKey, resolveJobReadScope } from '@/lib/job-access';
import {
  createWorkspaceJobContextKey,
  getJobFirstModule,
  getJobSelectorPath,
  isValidJobIdentifier,
} from '@/navigation/dashboard-modules';
import { formatJobStatusLabel } from '@/pages/job-status';

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

const LoadingJob = () => (
  <div className="flex min-h-[70vh] items-center justify-center px-6">
    <div className="flex items-center gap-3 text-sm font-semibold text-muted-foreground" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" aria-hidden="true" />
      Verifying job access…
    </div>
  </div>
);

export default function JobModuleRecords() {
  const { user } = useAuth();
  const { company, membership } = useCompany();
  const { jobId, moduleKey } = useParams();
  const module = getJobFirstModule(moduleKey);
  const requestIdRef = useRef(0);
  const [job, setJob] = useState(null);
  const [jobState, setJobState] = useState('loading');
  const [verifiedRequestKey, setVerifiedRequestKey] = useState(null);

  const jobScope = useMemo(() => resolveJobReadScope({
    userId: user?.id,
    company,
    membership,
  }), [company, membership, user?.id]);
  const scopeKey = createJobScopeKey(jobScope);
  const normalizedJobId = isValidJobIdentifier(jobId) ? jobId.trim().toLowerCase() : null;
  const requestKey = scopeKey && module && normalizedJobId
    ? `${scopeKey}:${module.key}:${normalizedJobId}`
    : null;
  const hasCurrentVerification = Boolean(requestKey) && verifiedRequestKey === requestKey;
  const visibleJob = hasCurrentVerification ? job : null;
  const visibleJobState = requestKey && !hasCurrentVerification ? 'loading' : jobState;

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setJob(null);
    setVerifiedRequestKey(null);

    if (!module || !normalizedJobId || !jobScope || !requestKey) {
      setJobState('unavailable');
      return;
    }

    setJobState('loading');
    onsiteApi.jobs.get(jobScope.companyId, normalizedJobId)
      .then(result => {
        if (requestId !== requestIdRef.current) return;
        if (!result) {
          setVerifiedRequestKey(requestKey);
          setJobState('unavailable');
          return;
        }
        setJob(result);
        setVerifiedRequestKey(requestKey);
        setJobState('ready');
      })
      .catch(error => {
        if (requestId !== requestIdRef.current) return;
        console.error('Failed to verify Supabase job context:', error);
        setVerifiedRequestKey(requestKey);
        setJobState('unavailable');
      });

    return () => {
      requestIdRef.current += 1;
    };
  }, [jobScope, module, normalizedJobId, requestKey]);

  if (!module) {
    return <InvalidRoute message="This module is not part of the approved job-first workspace." moduleKey={moduleKey} />;
  }
  if (!normalizedJobId) {
    return <InvalidRoute message="The URL does not contain a valid job identifier. Choose the job again from the company-scoped list." moduleKey={moduleKey} />;
  }
  if (visibleJobState === 'loading') return <LoadingJob />;
  if (visibleJobState !== 'ready' || !visibleJob || !jobScope) {
    return <InvalidRoute message="The requested job is unavailable in the active workspace." moduleKey={moduleKey} />;
  }

  const contextKey = createWorkspaceJobContextKey(jobScope.companyId, moduleKey, visibleJob.id);
  if (!contextKey) {
    return <InvalidRoute message="The requested job is unavailable in the active workspace." moduleKey={moduleKey} />;
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
              <p className="mt-2 truncate text-sm text-muted-foreground">
                {visibleJob.job_name} · {jobScope.companyName}
              </p>
            </div>
          </div>
        </header>

        <section className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]" aria-label={`${module.label} job status`}>
          {module.key === 'purchase-orders' ? (
            <PurchaseOrderRecords jobScope={jobScope} job={visibleJob} />
          ) : module.key === 'toolbox-talks' ? (
            <ToolboxTalkRecords jobScope={jobScope} job={visibleJob} />
          ) : module.key === 'site-diaries' ? (
            <SiteDiaryRecords jobScope={jobScope} job={visibleJob} />
          ) : (
            <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
              <DatabaseZap className="h-8 w-8 text-primary" aria-hidden="true" />
              <h2 className="mt-5 text-xl font-black">Module integration pending</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Job access has been verified for {visibleJob.job_name}. {module.label} records are not connected during W03-C, so no module records have been requested, cached or fabricated.
              </p>
              <div className="mt-6 rounded-2xl border border-dashed border-border bg-secondary/40 p-5">
                <p className="text-sm font-bold">No module records to display</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">The selected job is authorised; the module workflow remains deliberately unavailable until its own approved integration checkpoint.</p>
              </div>
            </div>
          )}

          <aside className="rounded-3xl border border-border bg-card p-6" aria-label="Selected job context">
            <div className="flex items-center gap-3">
              <BriefcaseBusiness className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="font-black">Selected job</h2>
            </div>
            <p className="mt-4 font-bold text-foreground">{visibleJob.job_name}</p>
            <p className="mt-1 text-xs font-mono text-muted-foreground">#{visibleJob.job_number}</p>
            <p className="mt-3 text-xs font-semibold text-muted-foreground">{formatJobStatusLabel(visibleJob.status)}</p>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">This context was loaded using both the active company and job identifier. The backend remains the authorization boundary.</p>
          </aside>
        </section>
      </div>
    </div>
  );
}
