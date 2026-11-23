import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  Clock,
  LockKeyhole,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { onsiteApi } from '@/api/supabase/adapter';
import { timesheetAdminErrorMessage } from '@/api/supabase/timesheets-admin-adapter';
import { addTimesheetCalendarDays } from '@/api/supabase/timesheets-read-adapter';
import TimesheetAdminActionDialog from '@/components/timesheets/TimesheetAdminActionDialog';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/companyContext';
import {
  canReadCompanyTimesheets,
  createTimesheetRequestKey,
  getSydneyDateKey,
  isTimesheetPermissionError,
  resolveTimesheetReadScope,
} from '@/lib/timesheet-access';

const PERIOD_TIME_ZONE = 'Australia/Sydney';

const displayDate = (value, options = {}) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: options.includeYear === false ? undefined : 'numeric',
    weekday: options.weekday ? 'short' : undefined,
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

const displayTime = value => new Intl.DateTimeFormat('en-AU', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: PERIOD_TIME_ZONE,
}).format(new Date(value));

const periodStatusLabel = status => ({
  open: 'Open',
  submitted: 'Review required',
  approved: 'Locked',
})[status] || 'Open';

const entryStatusLabel = status => ({
  active: 'In progress',
  completed: 'Clocked',
  manual: 'Manual',
})[status] || 'Unavailable';

const roleLabel = role => ({ owner: 'Owner', admin: 'Admin', worker: 'Worker' })[role] || 'Worker';
const workerDisplayName = entry => entry.worker_name || entry.worker_email || 'Team member';
const storedHoursTotal = entries => Math.round(entries.reduce((total, entry) => (
  entry.status === 'active' || entry.total_hours === null ? total : total + entry.total_hours
), 0) * 100) / 100;

export default function Timesheets() {
  const { user } = useAuth();
  const { company, membership, loadingCompany, companyError } = useCompany();
  const requestIdRef = useRef(0);
  const adminResourceRequestIdRef = useRef(0);
  const activeMutationContextRef = useRef(null);
  const [anchorDate, setAnchorDate] = useState(getSydneyDateKey);
  const [result, setResult] = useState(null);
  const [resultRequestKey, setResultRequestKey] = useState(null);
  const [timesheetState, setTimesheetState] = useState('loading');
  const [reloadVersion, setReloadVersion] = useState(0);
  const [workerFilter, setWorkerFilter] = useState('all');
  const [jobFilter, setJobFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [adminResources, setAdminResources] = useState({ key: null, state: 'idle', jobs: [], members: [], error: '' });
  const [adminAction, setAdminAction] = useState(null);
  const [mutationState, setMutationState] = useState({ busy: false, error: '', success: '' });

  const timesheetScope = useMemo(() => resolveTimesheetReadScope({
    userId: user?.id,
    company,
    membership,
  }), [company, membership, user?.id]);
  const view = canReadCompanyTimesheets(timesheetScope) ? 'company' : 'mine';
  const requestKey = createTimesheetRequestKey(timesheetScope, anchorDate, view);
  activeMutationContextRef.current = requestKey;
  const hasCurrentResult = Boolean(requestKey) && resultRequestKey === requestKey;
  const visibleResult = hasCurrentResult ? result : null;
  const visibleState = !timesheetScope
    ? 'unavailable'
    : !requestKey
      ? 'invalid-range'
      : hasCurrentResult
        ? timesheetState
        : 'loading';

  useEffect(() => {
    setWorkerFilter('all');
    setJobFilter('all');
    setStatusFilter('all');
    setAdminAction(null);
    setMutationState({ busy: false, error: '', success: '' });
  }, [requestKey]);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setResult(null);
    setResultRequestKey(null);

    if (!timesheetScope || !requestKey) {
      setTimesheetState(timesheetScope ? 'invalid-range' : 'unavailable');
      return;
    }

    setTimesheetState('loading');
    const operation = view === 'company'
      ? onsiteApi.timesheetsRead.listCompany(timesheetScope, anchorDate)
      : onsiteApi.timesheetsRead.listMine(timesheetScope, anchorDate);

    operation
      .then(nextResult => {
        if (requestId !== requestIdRef.current) return;
        setResult(nextResult);
        setResultRequestKey(requestKey);
        setTimesheetState(nextResult.entries.length === 0 ? 'empty' : 'ready');
      })
      .catch(error => {
        if (requestId !== requestIdRef.current) return;
        console.error('Failed to load Supabase Timesheets:', error);
        setResult(null);
        setResultRequestKey(requestKey);
        setTimesheetState(isTimesheetPermissionError(error) ? 'denied' : 'error');
      });

    return () => { requestIdRef.current += 1; };
  }, [anchorDate, reloadVersion, requestKey, timesheetScope, view]);

  useEffect(() => {
    const requestId = adminResourceRequestIdRef.current + 1;
    adminResourceRequestIdRef.current = requestId;
    setAdminResources({ key: null, state: 'idle', jobs: [], members: [], error: '' });
    if (!timesheetScope || !requestKey || view !== 'company') return;

    setAdminResources({ key: requestKey, state: 'loading', jobs: [], members: [], error: '' });
    Promise.all([
      onsiteApi.jobs.list(timesheetScope.companyId),
      onsiteApi.teamDirectory.list(timesheetScope.companyId),
    ])
      .then(([jobs, members]) => {
        if (requestId !== adminResourceRequestIdRef.current) return;
        setAdminResources({ key: requestKey, state: 'ready', jobs, members, error: '' });
      })
      .catch(error => {
        if (requestId !== adminResourceRequestIdRef.current) return;
        console.error('Failed to load Timesheet administration resources:', error);
        setAdminResources({
          key: requestKey,
          state: isTimesheetPermissionError(error) ? 'denied' : 'error',
          jobs: [],
          members: [],
          error: isTimesheetPermissionError(error)
            ? 'Current Owner/Admin access could not be confirmed.'
            : 'Workers and Jobs could not be loaded for administrative actions.',
        });
      });

    return () => { adminResourceRequestIdRef.current += 1; };
  }, [requestKey, timesheetScope, view]);

  const periodByWorker = useMemo(() => new Map(
    (visibleResult?.periods ?? []).map(period => [period.worker_reference_id, period])
  ), [visibleResult]);
  const workerOptions = useMemo(() => {
    const workers = new Map();
    if (adminResources.key === requestKey && adminResources.state === 'ready') {
      for (const member of adminResources.members) {
        workers.set(member.user_id, member.full_name || member.email || member.phone || 'Team member');
      }
    }
    for (const entry of visibleResult?.entries ?? []) {
      workers.set(entry.worker_reference_id, workerDisplayName(entry));
    }
    for (const period of visibleResult?.periods ?? []) {
      workers.set(
        period.worker_reference_id,
        period.worker_name || period.worker_email || workers.get(period.worker_reference_id) || 'Team member'
      );
    }
    return [...workers].sort((left, right) => left[1].localeCompare(right[1], 'en-AU'));
  }, [adminResources, requestKey, visibleResult]);
  const jobOptions = useMemo(() => {
    const jobs = new Map();
    for (const entry of visibleResult?.entries ?? []) {
      if (entry.job_id) jobs.set(entry.job_id, entry.job_name || entry.job_number || 'Linked Job');
    }
    return [...jobs].sort((left, right) => left[1].localeCompare(right[1], 'en-AU'));
  }, [visibleResult]);
  const adminSummaries = useMemo(() => workerOptions.map(([workerId, name]) => {
    const entries = (visibleResult?.entries ?? []).filter(entry => entry.worker_reference_id === workerId);
    const period = periodByWorker.get(workerId) ?? null;
    return {
      workerId,
      name,
      period,
      status: period?.status ?? 'open',
      totalHours: storedHoursTotal(entries),
      entryCount: entries.length,
      hasActiveEntries: entries.some(entry => entry.status === 'active'),
    };
  }), [periodByWorker, visibleResult, workerOptions]);
  const filteredEntries = useMemo(() => (visibleResult?.entries ?? []).filter(entry => (
    (workerFilter === 'all' || entry.worker_reference_id === workerFilter)
    && (jobFilter === 'all' || entry.job_id === jobFilter)
    && (statusFilter === 'all' || entry.status === statusFilter)
  )), [jobFilter, statusFilter, visibleResult, workerFilter]);
  const entriesByDate = useMemo(() => filteredEntries.reduce((groups, entry) => {
    if (!groups[entry.date]) groups[entry.date] = [];
    groups[entry.date].push(entry);
    return groups;
  }, {}), [filteredEntries]);
  const days = visibleResult
    ? Array.from({ length: 7 }, (_, index) => addTimesheetCalendarDays(visibleResult.period_start, index))
    : [];
  const hasActiveFilters = workerFilter !== 'all' || jobFilter !== 'all' || statusFilter !== 'all';
  const personalPeriodStatus = visibleResult
    ? periodByWorker.get(timesheetScope?.userId)?.status ?? 'open'
    : 'open';
  const unavailableMessage = loadingCompany
    ? 'The active company workspace is being confirmed. Previous-company time entries are hidden.'
    : companyError
      ? 'The active company workspace could not be confirmed. No time entries are displayed.'
      : 'Sign in and select an authorised company workspace before viewing Timesheets.';
  const currentAdminResources = adminResources.key === requestKey ? adminResources : { state: 'idle', jobs: [], members: [], error: '' };
  const adminWorkers = workerOptions.map(([id, name]) => ({ id, name }));

  const openAdminAction = (type, details = {}) => {
    if (view !== 'company' || !visibleResult || currentAdminResources.state !== 'ready' || mutationState.busy) return;
    setMutationState({ busy: false, error: '', success: '' });
    setAdminAction({ type, contextKey: requestKey, ...details });
  };

  const closeAdminAction = () => {
    if (!mutationState.busy) {
      setAdminAction(null);
      setMutationState(current => ({ ...current, error: '' }));
    }
  };

  const submitAdminAction = async (form) => {
    if (!adminAction || !timesheetScope || !visibleResult || adminAction.contextKey !== requestKey) {
      throw new Error('The active Timesheets workspace changed. Open the action again.');
    }
    const contextKey = adminAction.contextKey;
    setMutationState({ busy: true, error: '', success: '' });
    try {
      if (adminAction.type === 'create') {
        await onsiteApi.timesheetsAdmin.createManual(timesheetScope, {
          ...form,
          companyId: timesheetScope.companyId,
          periodStatus: periodByWorker.get(form.workerReferenceId)?.status ?? 'open',
          range: { periodStart: visibleResult.period_start, periodEnd: visibleResult.period_end },
        });
      } else if (adminAction.type === 'correct') {
        await onsiteApi.timesheetsAdmin.correct(timesheetScope, {
          ...form,
          entry: {
            ...adminAction.entry,
            periodStatus: periodByWorker.get(adminAction.entry.worker_reference_id)?.status ?? 'open',
          },
          range: { periodStart: visibleResult.period_start, periodEnd: visibleResult.period_end },
        });
      } else if (adminAction.type === 'recover') {
        await onsiteApi.timesheetsAdmin.recover(timesheetScope, {
          ...form,
          entry: {
            ...adminAction.entry,
            periodStatus: periodByWorker.get(adminAction.entry.worker_reference_id)?.status ?? 'open',
          },
          range: { periodStart: visibleResult.period_start, periodEnd: visibleResult.period_end },
        });
      } else if (adminAction.type === 'void') {
        await onsiteApi.timesheetsAdmin.void(timesheetScope, {
          reason: form.reason,
          entry: {
            ...adminAction.entry,
            periodStatus: periodByWorker.get(adminAction.entry.worker_reference_id)?.status ?? 'open',
          },
          range: { periodStart: visibleResult.period_start, periodEnd: visibleResult.period_end },
        });
      } else if (adminAction.type === 'finalise') {
        await onsiteApi.timesheetsAdmin.finalise(timesheetScope, {
          workerReferenceId: adminAction.summary.workerId,
          periodStatus: adminAction.summary.status,
          entryCount: adminAction.summary.entryCount,
          hasActiveEntries: adminAction.summary.hasActiveEntries,
          range: { periodStart: visibleResult.period_start, periodEnd: visibleResult.period_end },
        });
      } else if (adminAction.type === 'reopen') {
        await onsiteApi.timesheetsAdmin.reopen(timesheetScope, {
          period: adminAction.summary.period,
          reason: form.reason,
          range: { periodStart: visibleResult.period_start, periodEnd: visibleResult.period_end },
        });
      } else {
        throw new Error('Unsupported Timesheet action.');
      }

      if (activeMutationContextRef.current !== contextKey) return;
      setAdminAction(null);
      setMutationState({ busy: false, error: '', success: 'Timesheet action confirmed. Authoritative records have been refreshed.' });
      setReloadVersion(version => version + 1);
    } catch (error) {
      if (activeMutationContextRef.current !== contextKey) return;
      const message = timesheetAdminErrorMessage(error);
      setMutationState({ busy: false, error: message, success: '' });
      throw new Error(message);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-4 px-6 pb-4 pt-14">
        <Link to="/" className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary" aria-label="Back to dashboard">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-black">Timesheets</h1>
          <p className="truncate text-xs text-muted-foreground">
            {timesheetScope ? `${timesheetScope.companyName} · ${roleLabel(timesheetScope.role)}` : 'Active workspace required'}
          </p>
        </div>
        <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-primary">
          {view === 'company' ? 'Owner/Admin review' : 'Read only'}
        </span>
      </header>

      <main className="space-y-4 px-6 pb-10">
        <section className="rounded-3xl border border-border bg-card p-4" aria-label="Pay week navigation">
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => setAnchorDate(date => addTimesheetCalendarDays(date, -7))} className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary" aria-label="Previous pay week">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 text-center">
              <p className="text-sm font-black">
                {visibleResult
                  ? `${displayDate(visibleResult.period_start, { includeYear: false })} – ${displayDate(visibleResult.period_end)}`
                  : 'Selected pay week'}
              </p>
              <p className="mt-1 text-xs font-bold text-primary">
                {visibleResult ? `${storedHoursTotal(filteredEntries).toFixed(2)} recorded hrs` : 'Loading recorded hours'}
              </p>
            </div>
            <button type="button" onClick={() => setAnchorDate(date => addTimesheetCalendarDays(date, 7))} className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary" aria-label="Next pay week">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {visibleResult && (
            <div className="mt-4 grid grid-cols-7 gap-1" aria-label="Pay week days">
              {days.map(date => (
                <div key={date} className="rounded-xl bg-muted/50 py-2 text-center">
                  <span className="block text-[9px] font-bold uppercase text-muted-foreground">{displayDate(date, { includeYear: false, weekday: true }).split(' ')[0]}</span>
                  <span className="mt-1 block text-sm font-black">{Number(date.slice(-2))}</span>
                  {entriesByDate[date]?.length > 0 && <span className="mx-auto mt-1 block h-1.5 w-1.5 rounded-full bg-primary" />}
                </div>
              ))}
            </div>
          )}
        </section>

        {visibleResult && view === 'mine' && (
          <section className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">My period</p>
              <p className="mt-1 text-sm font-black">{periodStatusLabel(personalPeriodStatus)}</p>
            </div>
            <LockKeyhole className="h-5 w-5 text-primary" aria-hidden="true" />
          </section>
        )}

        {visibleResult && view === 'company' && (
          <>
            <section className="flex flex-col gap-3 rounded-3xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Timesheet administration">
              <div>
                <h2 className="text-sm font-black">Timesheet administration</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Corrections and period changes are submitted to the audited native RPC boundary. Stored hours are never recalculated in the browser.</p>
              </div>
              <button
                type="button"
                disabled={currentAdminResources.state !== 'ready' || mutationState.busy}
                onClick={() => openAdminAction('create')}
                className="flex min-h-11 flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-black text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                Add manual entry
              </button>
            </section>
            {currentAdminResources.state === 'loading' && <p className="rounded-2xl border border-border bg-card p-4 text-xs text-muted-foreground" role="status">Confirming company workers and Jobs for administrative actions…</p>}
            {['denied', 'error'].includes(currentAdminResources.state) && <p className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-xs text-amber-100" role="alert">{currentAdminResources.error} Existing read-only records remain available.</p>}
            {mutationState.success && <p className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-xs text-emerald-200" role="status">{mutationState.success}</p>}
            <section className="grid gap-3 rounded-3xl border border-border bg-card p-4 md:grid-cols-3" aria-label="Timesheet filters">
              <FilterSelect label="Worker" value={workerFilter} onChange={setWorkerFilter}>
                <option value="all">All workers</option>
                {workerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </FilterSelect>
              <FilterSelect label="Job" value={jobFilter} onChange={setJobFilter}>
                <option value="all">All jobs</option>
                {jobOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </FilterSelect>
              <FilterSelect label="Entry type" value={statusFilter} onChange={setStatusFilter}>
                <option value="all">All entry types</option>
                <option value="active">In progress</option>
                <option value="completed">Clocked</option>
                <option value="manual">Manual</option>
              </FilterSelect>
            </section>
            {adminSummaries.length > 0 && (
              <section className="rounded-3xl border border-border bg-card p-4" aria-label="Company period states">
                <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground">Company period states</h2>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {adminSummaries.map(summary => (
                    <div key={summary.workerId} className="flex flex-col gap-3 rounded-2xl bg-muted/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black">{summary.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{summary.totalHours.toFixed(2)} recorded hrs · {summary.entryCount} {summary.entryCount === 1 ? 'entry' : 'entries'}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-black uppercase text-primary">{periodStatusLabel(summary.status)}</span>
                        {summary.status === 'open' && (
                          <button
                            type="button"
                            disabled={currentAdminResources.state !== 'ready' || mutationState.busy || summary.entryCount === 0 || summary.hasActiveEntries}
                            onClick={() => openAdminAction('finalise', { worker: { id: summary.workerId, name: summary.name }, summary })}
                            className="min-h-9 rounded-xl bg-primary px-3 text-xs font-black text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
                            title={summary.hasActiveEntries ? 'Recover or finish the active entry first' : summary.entryCount === 0 ? 'At least one entry is required' : 'Finalise and lock this pay week'}
                          >
                            Finalise
                          </button>
                        )}
                        {['approved', 'submitted'].includes(summary.status) && summary.period && (
                          <button
                            type="button"
                            disabled={currentAdminResources.state !== 'ready' || mutationState.busy}
                            onClick={() => openAdminAction('reopen', { worker: { id: summary.workerId, name: summary.name }, summary })}
                            className="flex min-h-9 items-center gap-1 rounded-xl bg-secondary px-3 text-xs font-black text-foreground disabled:opacity-40"
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> Reopen
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {visibleState === 'loading' && <TimesheetNotice icon={Clock} title="Loading Timesheets" message="Reading the authorised pay week for the active workspace." />}
        {visibleState === 'unavailable' && <TimesheetNotice icon={ShieldCheck} title="Timesheets unavailable" message={unavailableMessage} />}
        {visibleState === 'invalid-range' && <TimesheetNotice alert icon={AlertTriangle} title="Pay week unavailable" message="The requested Timesheets date could not be validated." />}
        {visibleState === 'denied' && <TimesheetNotice alert icon={ShieldCheck} title="Timesheet access restricted" message="Supabase denied this Timesheets read for the current workspace. No broader or privileged fallback was attempted." />}
        {visibleState === 'error' && <TimesheetNotice alert icon={AlertTriangle} title="Timesheets unavailable" message="Time entries could not be loaded. No previous-company or previous-account records are displayed." />}
        {visibleState === 'empty' && <TimesheetNotice icon={Clock} title="No recorded time" message="No authorised time entries were found for this pay week." />}
        {visibleState === 'ready' && filteredEntries.length === 0 && hasActiveFilters && (
          <TimesheetNotice icon={BriefcaseBusiness} title="No matching entries" message="No recorded time matches the selected worker, Job and entry-type filters." />
        )}

        {visibleState === 'ready' && filteredEntries.length > 0 && (
          <div className="space-y-5">
            {days.map(date => {
              const entries = entriesByDate[date] ?? [];
              if (entries.length === 0) return null;
              return (
                <section key={date} aria-labelledby={`timesheet-day-${date}`}>
                  <h2 id={`timesheet-day-${date}`} className="mb-2 text-xs font-black uppercase tracking-wider text-muted-foreground">
                    {displayDate(date, { weekday: true })}
                  </h2>
                  <div className="space-y-2">
                    {entries.map(entry => (
                      <TimeEntryCard
                        key={entry.id}
                        entry={entry}
                        periodStatus={periodByWorker.get(entry.worker_reference_id)?.status ?? 'open'}
                        showWorker={view === 'company'}
                        canManage={view === 'company' && currentAdminResources.state === 'ready' && !mutationState.busy}
                        onAction={(type) => openAdminAction(type, {
                          entry,
                          worker: { id: entry.worker_reference_id, name: workerDisplayName(entry) },
                        })}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
      {adminAction && visibleResult && view === 'company' && (
        <TimesheetAdminActionDialog
          key={`${adminAction.contextKey}:${adminAction.type}:${adminAction.entry?.id ?? adminAction.summary?.workerId ?? 'new'}`}
          action={adminAction}
          busy={mutationState.busy}
          error={mutationState.error}
          jobs={currentAdminResources.jobs}
          onClose={closeAdminAction}
          onSubmit={submitAdminAction}
          range={{ periodStart: visibleResult.period_start, periodEnd: visibleResult.period_end }}
          workers={adminWorkers}
        />
      )}
    </div>
  );
}

const FilterSelect = ({ label, value, onChange, children }) => (
  <label className="text-xs font-bold text-muted-foreground">
    {label}
    <select value={value} onChange={event => onChange(event.target.value)} className="mt-1 block w-full rounded-xl border border-border bg-muted px-3 py-2 text-sm font-semibold text-foreground outline-none">
      {children}
    </select>
  </label>
);

const TimeEntryCard = ({ canManage, entry, onAction, periodStatus, showWorker }) => {
  const job = [entry.job_name, entry.job_number ? `#${entry.job_number}` : null].filter(Boolean).join(' · ') || 'No linked Job';
  const active = entry.status === 'active';
  return (
    <article className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-500/15">
          <Clock className="h-5 w-5 text-amber-400" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              {showWorker && (
                <p className="flex items-center gap-1 text-xs font-bold text-primary">
                  <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                  {workerDisplayName(entry)}
                </p>
              )}
              <h3 className="mt-1 truncate text-sm font-black">{job}</h3>
            </div>
            <div className="flex flex-wrap justify-end gap-1">
              <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-black uppercase text-muted-foreground">{entryStatusLabel(entry.status)}</span>
              {showWorker && <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-black uppercase text-primary">{periodStatusLabel(periodStatus)}</span>}
            </div>
          </div>
          <p className="mt-2 text-sm font-semibold">
            {displayTime(entry.start_time)} → {entry.finish_time ? displayTime(entry.finish_time) : 'In progress'}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Break: {entry.lunch_break_mins} min</span>
            <span>{active || entry.total_hours === null ? 'Recorded hours pending' : `${entry.total_hours.toFixed(2)} recorded hrs`}</span>
          </div>
          {entry.notes && <p className="mt-2 text-xs leading-5 text-muted-foreground">{entry.notes}</p>}
          {canManage && periodStatus === 'open' && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3" aria-label={`Administrative actions for ${job}`}>
              {active ? (
                <button type="button" onClick={() => onAction('recover')} className="flex min-h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-black text-primary-foreground">
                  <Clock className="h-3.5 w-3.5" /> Recover entry
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => onAction('correct')} className="flex min-h-9 items-center gap-1.5 rounded-xl bg-secondary px-3 text-xs font-black text-foreground">
                    <Pencil className="h-3.5 w-3.5" /> Correct
                  </button>
                  <button type="button" onClick={() => onAction('void')} className="flex min-h-9 items-center gap-1.5 rounded-xl border border-rose-400/20 bg-rose-400/5 px-3 text-xs font-black text-rose-300">
                    <Trash2 className="h-3.5 w-3.5" /> Void
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
};

const TimesheetNotice = ({ icon: Icon, title, message, alert = false }) => (
  <div className={`rounded-3xl border bg-card p-8 text-center ${alert ? 'border-amber-400/20' : 'border-border'}`} role={alert ? 'alert' : 'status'}>
    <Icon className={`mx-auto h-9 w-9 ${alert ? 'text-amber-400' : 'text-primary'}`} aria-hidden="true" />
    <h2 className="mt-4 text-xl font-black">{title}</h2>
    <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{message}</p>
  </div>
);
