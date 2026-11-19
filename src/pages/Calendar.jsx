import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BriefcaseBusiness, CalendarDays, ChevronLeft, ShieldCheck, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { onsiteApi } from '@/api/supabase/adapter';
import { useAuth } from '@/lib/AuthContext';
import {
  createCalendarRequestKey,
  isCalendarPermissionError,
  resolveCalendarReadScope,
} from '@/lib/calendar-access';
import { useCompany } from '@/lib/companyContext';

const dateKey = (date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
);

const createCurrentMonthRange = () => {
  const now = new Date();
  return {
    startDate: dateKey(new Date(now.getFullYear(), now.getMonth(), 1)),
    endDate: dateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
};

const displayDate = (value) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

const displayRange = event => event.start_date === event.end_date
  ? displayDate(event.start_date)
  : `${displayDate(event.start_date)} – ${displayDate(event.end_date)}`;

const roleLabel = role => ({ owner: 'Owner', admin: 'Admin', worker: 'Worker' })[role] || 'Worker';

export default function Calendar() {
  const { user } = useAuth();
  const { company, membership, loadingCompany, companyError } = useCompany();
  const requestIdRef = useRef(0);
  const [range, setRange] = useState(createCurrentMonthRange);
  const [events, setEvents] = useState([]);
  const [resultRequestKey, setResultRequestKey] = useState(null);
  const [calendarState, setCalendarState] = useState('loading');

  const calendarScope = useMemo(() => resolveCalendarReadScope({
    userId: user?.id,
    company,
    membership,
  }), [company, membership, user?.id]);
  const requestKey = createCalendarRequestKey(calendarScope, range.startDate, range.endDate);
  const hasCurrentResult = Boolean(requestKey) && resultRequestKey === requestKey;
  const visibleEvents = hasCurrentResult ? events : [];
  const visibleState = !calendarScope
    ? 'unavailable'
    : !requestKey
      ? 'invalid-range'
      : hasCurrentResult
        ? calendarState
        : 'loading';

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setEvents([]);
    setResultRequestKey(null);

    if (!calendarScope) {
      setCalendarState('unavailable');
      return;
    }
    if (!requestKey) {
      setCalendarState('invalid-range');
      return;
    }

    setCalendarState('loading');
    onsiteApi.calendarRead.list(calendarScope, range.startDate, range.endDate)
      .then(result => {
        if (requestId !== requestIdRef.current) return;
        setEvents(result);
        setResultRequestKey(requestKey);
        setCalendarState(result.length === 0 ? 'empty' : 'ready');
      })
      .catch(error => {
        if (requestId !== requestIdRef.current) return;
        console.error('Failed to load Supabase Calendar events:', error);
        setEvents([]);
        setResultRequestKey(requestKey);
        setCalendarState(isCalendarPermissionError(error) ? 'denied' : 'error');
      });

    return () => { requestIdRef.current += 1; };
  }, [calendarScope, range.endDate, range.startDate, requestKey]);

  const groupedEvents = useMemo(() => visibleEvents.reduce((groups, event) => {
    const key = event.start_date;
    if (!groups[key]) groups[key] = [];
    groups[key].push(event);
    return groups;
  }, {}), [visibleEvents]);

  const unavailableMessage = loadingCompany
    ? 'The active company workspace is being confirmed. Previous-company Calendar events are hidden.'
    : companyError
      ? 'The active company workspace could not be confirmed. No Calendar events are displayed.'
      : 'Sign in and select an authorised company workspace before viewing the Calendar.';

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-5 pb-24 pt-10 sm:px-8 lg:pb-12 lg:pt-16">
        <header className="flex items-start gap-4">
          <Link to="/" aria-label="Back to dashboard" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Read-only team schedule</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight">Calendar</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {calendarScope?.companyName || 'Active company workspace'}
              {calendarScope ? ` · ${roleLabel(calendarScope.role)}` : ''}
            </p>
          </div>
        </header>

        <section className="mt-6 grid gap-3 rounded-3xl border border-border bg-card p-5 sm:grid-cols-2" aria-label="Calendar date range">
          <label className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            From
            <input
              type="date"
              value={range.startDate}
              onChange={event => setRange(current => ({ ...current, startDate: event.target.value }))}
              className="mt-2 block w-full rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm font-medium normal-case tracking-normal text-foreground outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
          <label className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            To
            <input
              type="date"
              value={range.endDate}
              onChange={event => setRange(current => ({ ...current, endDate: event.target.value }))}
              className="mt-2 block w-full rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm font-medium normal-case tracking-normal text-foreground outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
        </section>

        <section className="mt-6" aria-label="Authorised Calendar events">
          {visibleState === 'loading' ? (
            <div className="space-y-4" aria-label="Loading Calendar events" aria-busy="true">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="h-36 animate-pulse rounded-3xl border border-border bg-card" />
              ))}
            </div>
          ) : visibleState === 'unavailable' ? (
            <CalendarNotice icon={ShieldCheck} title="Calendar unavailable" message={unavailableMessage} />
          ) : visibleState === 'invalid-range' ? (
            <CalendarNotice alert icon={AlertTriangle} title="Choose a valid date range" message="The end date must be on or after the start date, and the range cannot exceed 371 days." />
          ) : visibleState === 'denied' ? (
            <CalendarNotice alert icon={ShieldCheck} title="Calendar access restricted" message="The Calendar RPC denied access for the current authenticated workspace. No direct-table fallback was attempted." />
          ) : visibleState === 'error' ? (
            <CalendarNotice alert icon={AlertTriangle} title="Calendar unavailable" message="Calendar events could not be loaded. No previous-company events are displayed." />
          ) : visibleState === 'empty' ? (
            <CalendarNotice icon={CalendarDays} title="No Calendar events" message="No authorised events overlap the selected date range." />
          ) : (
            <div className="space-y-7">
              {Object.keys(groupedEvents).sort().map(startDate => (
                <section key={startDate} aria-labelledby={`calendar-date-${startDate}`}>
                  <h2 id={`calendar-date-${startDate}`} className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">
                    {displayDate(startDate)}
                  </h2>
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    {groupedEvents[startDate].map(event => (
                      <CalendarEventCard key={event.id} event={event} showNotes={calendarScope.role === 'owner' || calendarScope.role === 'admin'} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const CalendarEventCard = ({ event, showNotes }) => {
  const isLeave = event.source_type === 'leave';
  return (
    <article className="rounded-3xl border border-border bg-card p-5">
      <div className="flex items-start gap-4">
        <span className="mt-1 h-12 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: event.color }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-black">{event.title}</h3>
            <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {isLeave ? 'Team availability' : 'Scheduled event'}
            </span>
          </div>
          <p className="mt-2 text-sm font-semibold text-primary">{displayRange(event)}</p>

          {!isLeave && (event.job_name || event.job_number) && (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <BriefcaseBusiness className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>
                {event.job_name || 'Linked job'}
                {event.job_number ? ` · #${event.job_number}` : ''}
              </span>
            </p>
          )}

          {isLeave && (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <UserRound className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              Approved leave availability only
            </p>
          )}

          {showNotes && !isLeave && event.notes && (
            <p className="mt-3 border-t border-border pt-3 text-sm leading-6 text-muted-foreground">{event.notes}</p>
          )}
        </div>
      </div>
    </article>
  );
};

const CalendarNotice = ({ icon: Icon, title, message, alert = false }) => (
  <div className={`rounded-3xl border bg-card p-8 text-center ${alert ? 'border-amber-400/20' : 'border-border'}`} role={alert ? 'alert' : 'status'}>
    <Icon className={`mx-auto h-9 w-9 ${alert ? 'text-amber-400' : 'text-primary'}`} aria-hidden="true" />
    <h2 className="mt-4 text-xl font-black">{title}</h2>
    <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{message}</p>
  </div>
);
