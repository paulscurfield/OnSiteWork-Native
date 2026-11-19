import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarDays, ChevronLeft, ShieldCheck, UserRound, UsersRound } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Link } from 'react-router-dom';
import { onsiteApi } from '@/api/supabase/adapter';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/companyContext';
import {
  canReadCompanyLeave,
  createLeaveScopeKey,
  isLeavePermissionError,
  resolveLeaveReadScope,
} from '@/lib/leave-access';

const leaveTypeLabels = {
  annual: 'Annual leave',
  sick: 'Sick leave',
  personal: 'Personal leave',
  other: 'Other / unpaid leave',
};

const leaveTypeStyles = {
  annual: 'border-blue-500/25 bg-blue-500/10 text-blue-400',
  sick: 'border-rose-500/25 bg-rose-500/10 text-rose-400',
  personal: 'border-purple-500/25 bg-purple-500/10 text-purple-400',
  other: 'border-border bg-secondary text-muted-foreground',
};

const statusLabels = { pending: 'Pending', approved: 'Approved', declined: 'Declined' };
const statusStyles = {
  pending: 'bg-amber-500/10 text-amber-400',
  approved: 'bg-emerald-500/10 text-emerald-400',
  declined: 'bg-rose-500/10 text-rose-400',
};

const displayDate = value => format(parseISO(value), 'd MMM yyyy');
const displayRange = request => request.start_date === request.end_date
  ? displayDate(request.start_date)
  : `${displayDate(request.start_date)} – ${displayDate(request.end_date)}`;

export default function Leave() {
  const { user } = useAuth();
  const { company, membership, loadingCompany, companyError } = useCompany();
  const requestIdRef = useRef(0);
  const [personalRequests, setPersonalRequests] = useState([]);
  const [companyRequests, setCompanyRequests] = useState([]);
  const [resultScopeKey, setResultScopeKey] = useState(null);
  const [personalState, setPersonalState] = useState('loading');
  const [companyState, setCompanyState] = useState('unavailable');

  const leaveScope = useMemo(() => resolveLeaveReadScope({
    userId: user?.id,
    company,
    membership,
  }), [company, membership, user?.id]);
  const leaveScopeKey = createLeaveScopeKey(leaveScope);
  const canReadCompany = canReadCompanyLeave(leaveScope);
  const hasCurrentResult = Boolean(leaveScopeKey) && resultScopeKey === leaveScopeKey;
  const visiblePersonalRequests = hasCurrentResult ? personalRequests : [];
  const visibleCompanyRequests = hasCurrentResult ? companyRequests : [];
  const visiblePersonalState = !leaveScope
    ? 'unavailable'
    : hasCurrentResult
      ? personalState
      : 'loading';
  const visibleCompanyState = !canReadCompany
    ? 'unavailable'
    : hasCurrentResult
      ? companyState
      : 'loading';

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setPersonalRequests([]);
    setCompanyRequests([]);
    setResultScopeKey(null);

    if (!leaveScope || !leaveScopeKey) {
      setPersonalState('unavailable');
      setCompanyState('unavailable');
      return;
    }

    setPersonalState('loading');
    setCompanyState(canReadCompany ? 'loading' : 'unavailable');
    const personalRequest = onsiteApi.leaveRead.listMine(leaveScope);
    const companyRequest = canReadCompany
      ? onsiteApi.leaveRead.listCompany(leaveScope)
      : Promise.resolve(null);

    Promise.allSettled([personalRequest, companyRequest]).then(([personalResult, companyResult]) => {
      if (requestId !== requestIdRef.current) return;

      if (personalResult.status === 'fulfilled') {
        setPersonalRequests(personalResult.value);
        setPersonalState(personalResult.value.length === 0 ? 'empty' : 'ready');
      } else {
        console.error('Failed to load personal Supabase Leave requests:', personalResult.reason);
        setPersonalRequests([]);
        setPersonalState(isLeavePermissionError(personalResult.reason) ? 'denied' : 'error');
      }

      if (canReadCompany) {
        if (companyResult.status === 'fulfilled') {
          setCompanyRequests(companyResult.value);
          setCompanyState(companyResult.value.length === 0 ? 'empty' : 'ready');
        } else {
          console.error('Failed to load company Supabase Leave requests:', companyResult.reason);
          setCompanyRequests([]);
          setCompanyState(isLeavePermissionError(companyResult.reason) ? 'denied' : 'error');
        }
      }

      setResultScopeKey(leaveScopeKey);
    });

    return () => { requestIdRef.current += 1; };
  }, [canReadCompany, leaveScope, leaveScopeKey]);

  const unavailableMessage = loadingCompany
    ? 'The active company workspace is being confirmed. Previous-company Leave information is hidden.'
    : companyError
      ? 'The active company workspace could not be confirmed. No Leave information is displayed.'
      : 'Sign in and select an authorised company workspace before viewing Leave information.';

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-5 pb-24 pt-10 sm:px-8 lg:pb-12 lg:pt-16">
        <header className="flex items-start gap-4">
          <Link to="/" aria-label="Back to dashboard" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Read-only leave register</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight">Leave</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Review authorised leave information for {leaveScope?.companyName || 'the active company workspace'}.
            </p>
          </div>
        </header>

        <section className="mt-6 rounded-2xl border border-border bg-card px-5 py-4 text-sm text-muted-foreground">
          This checkpoint is view-only. Leave requests and decisions remain unavailable in the web administration app.
        </section>

        <section className="mt-6" aria-labelledby="personal-leave-heading">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <UserRound className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Private self-service view</p>
              <h2 id="personal-leave-heading" className="text-xl font-black">My leave requests</h2>
            </div>
          </div>
          <LeaveRequestList
            state={visiblePersonalState}
            requests={visiblePersonalRequests}
            unavailableMessage={unavailableMessage}
            emptyMessage="No personal leave requests were returned for this workspace."
            deniedMessage="Your personal Leave requests are not available for the confirmed workspace."
            errorMessage="Personal Leave requests could not be loaded. No previous-account information is displayed."
            showWorker={false}
            showNotes
          />
        </section>

        {canReadCompany && (
          <section className="mt-10" aria-labelledby="company-leave-heading">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <UsersRound className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Owner and Admin view</p>
                <h2 id="company-leave-heading" className="text-xl font-black">Company leave overview</h2>
              </div>
            </div>
            <LeaveRequestList
              state={visibleCompanyState}
              requests={visibleCompanyRequests}
              unavailableMessage="Active Owner or Admin access is required."
              emptyMessage="No company leave requests were returned for this workspace."
              deniedMessage="Company Leave access was denied. No direct-table fallback was attempted."
              errorMessage="Company Leave requests could not be loaded. No previous-company information is displayed."
              showWorker
              showNotes={false}
            />
          </section>
        )}
      </div>
    </div>
  );
}

const LeaveRequestList = ({
  state,
  requests,
  unavailableMessage,
  emptyMessage,
  deniedMessage,
  errorMessage,
  showWorker,
  showNotes,
}) => {
  if (state === 'loading') {
    return (
      <div className="mt-4 grid gap-4 md:grid-cols-2" aria-label="Loading Leave requests" aria-busy="true">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="h-40 animate-pulse rounded-3xl border border-border bg-card" />
        ))}
      </div>
    );
  }

  if (state === 'unavailable') return <LeaveNotice icon={ShieldCheck} title="Leave unavailable" message={unavailableMessage} />;
  if (state === 'denied') return <LeaveNotice alert icon={ShieldCheck} title="Leave access restricted" message={deniedMessage} />;
  if (state === 'error') return <LeaveNotice alert icon={AlertTriangle} title="Leave unavailable" message={errorMessage} />;
  if (state === 'empty') return <LeaveNotice icon={CalendarDays} title="No leave requests" message={emptyMessage} />;

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      {requests.map(request => (
        <article key={request.id} className="rounded-3xl border border-border bg-card p-5">
          {showWorker && (
            <p className="mb-4 flex items-center gap-2 font-black">
              <UserRound className="h-4 w-4 text-primary" aria-hidden="true" />
              {request.worker_name}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${leaveTypeStyles[request.leave_type]}`}>
              {leaveTypeLabels[request.leave_type]}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusStyles[request.status]}`}>
              {statusLabels[request.status]}
            </span>
          </div>
          <p className="mt-4 font-bold">{displayRange(request)}</p>
          {showNotes && request.notes && (
            <p className="mt-3 border-t border-border pt-3 text-sm leading-6 text-muted-foreground">{request.notes}</p>
          )}
        </article>
      ))}
    </div>
  );
};

const LeaveNotice = ({ icon: Icon, title, message, alert = false }) => (
  <div className={`mt-4 rounded-3xl border bg-card p-8 text-center ${alert ? 'border-amber-400/20' : 'border-border'}`} role={alert ? 'alert' : 'status'}>
    <Icon className={`mx-auto h-9 w-9 ${alert ? 'text-amber-400' : 'text-primary'}`} aria-hidden="true" />
    <h3 className="mt-4 text-lg font-black">{title}</h3>
    <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{message}</p>
  </div>
);
