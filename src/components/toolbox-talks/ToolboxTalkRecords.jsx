import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  ClipboardCheck,
  ShieldAlert,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';
import { onsiteApi } from '@/api/supabase/adapter';
import {
  createToolboxTalkRequestKey,
  createToolboxTalkScopeKey,
  isToolboxTalkPermissionError,
  resolveToolboxTalkReadScope,
} from '@/lib/toolbox-talk-access';

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', worker: 'Worker' };

const formatLocalDate = value => {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

const formatDateTime = (value, timeZone = 'Australia/Sydney') => new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short',
  timeZone,
  year: 'numeric',
}).format(new Date(value));

const formatAnswer = value => {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value.trim() || 'Not recorded';
  if (Array.isArray(value)) {
    const values = value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim());
    return values.length ? values.join(', ') : 'Not recorded';
  }
  return 'Not recorded';
};

export default function ToolboxTalkRecords({ jobScope, job }) {
  const listRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const [talks, setTalks] = useState([]);
  const [listState, setListState] = useState('loading');
  const [resultScopeKey, setResultScopeKey] = useState(null);
  const [selectedTalkId, setSelectedTalkId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailState, setDetailState] = useState('idle');
  const [detailResultKey, setDetailResultKey] = useState(null);

  const scope = useMemo(() => resolveToolboxTalkReadScope({ jobScope, job }), [job, jobScope]);
  const scopeKey = createToolboxTalkScopeKey(scope);
  const hasCurrentList = Boolean(scopeKey) && resultScopeKey === scopeKey;
  const visibleTalks = useMemo(() => hasCurrentList ? talks : [], [hasCurrentList, talks]);
  const visibleListState = !scope ? 'unavailable' : hasCurrentList ? listState : 'loading';
  const selectedTalkIsCurrent = Boolean(selectedTalkId)
    && visibleTalks.some(talk => talk.id === selectedTalkId);
  const detailRequestKey = selectedTalkIsCurrent
    ? createToolboxTalkRequestKey(scope, selectedTalkId)
    : null;
  const hasCurrentDetail = Boolean(detailRequestKey) && detailResultKey === detailRequestKey;
  const visibleDetail = hasCurrentDetail ? detail : null;
  const visibleDetailState = !selectedTalkId
    ? 'idle'
    : !selectedTalkIsCurrent
      ? 'unavailable'
      : hasCurrentDetail
        ? detailState
        : 'loading';

  useEffect(() => {
    const requestId = listRequestIdRef.current + 1;
    listRequestIdRef.current = requestId;
    setTalks([]);
    setResultScopeKey(null);
    setSelectedTalkId(null);
    setDetail(null);
    setDetailResultKey(null);

    if (!scope || !scopeKey) {
      setListState('unavailable');
      return;
    }

    setListState('loading');
    onsiteApi.toolboxTalksRead.list(scope)
      .then(result => {
        if (requestId !== listRequestIdRef.current) return;
        setTalks(result);
        setResultScopeKey(scopeKey);
        setListState(result.length === 0 ? 'empty' : 'ready');
      })
      .catch(error => {
        if (requestId !== listRequestIdRef.current) return;
        console.error('Failed to load Supabase Toolbox Talks:', error);
        setTalks([]);
        setResultScopeKey(scopeKey);
        setListState(isToolboxTalkPermissionError(error) ? 'denied' : 'error');
      });

    return () => { listRequestIdRef.current += 1; };
  }, [scope, scopeKey]);

  useEffect(() => {
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    setDetail(null);
    setDetailResultKey(null);

    if (!scope || !detailRequestKey || !selectedTalkIsCurrent) {
      setDetailState(selectedTalkId ? 'unavailable' : 'idle');
      return;
    }

    setDetailState('loading');
    onsiteApi.toolboxTalksRead.get(scope, selectedTalkId)
      .then(result => {
        if (requestId !== detailRequestIdRef.current) return;
        setDetail(result);
        setDetailResultKey(detailRequestKey);
        setDetailState('ready');
      })
      .catch(error => {
        if (requestId !== detailRequestIdRef.current) return;
        console.error('Failed to load Supabase Toolbox Talk details:', error);
        setDetail(null);
        setDetailResultKey(detailRequestKey);
        setDetailState(isToolboxTalkPermissionError(error) ? 'denied' : 'error');
      });

    return () => { detailRequestIdRef.current += 1; };
  }, [detailRequestKey, scope, selectedTalkId, selectedTalkIsCurrent]);

  return (
    <section className="min-w-0 rounded-3xl border border-border bg-card p-6 sm:p-8" aria-label="Toolbox Talk records">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
            <p className="text-xs font-black uppercase tracking-[0.16em]">Read-only safety records</p>
          </div>
          <h2 className="mt-3 text-xl font-black">Completed Toolbox Talks</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {scope ? `${scope.jobName} · ${ROLE_LABELS[scope.role]}` : 'Verified job access required'}
          </p>
        </div>
        <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-primary">
          View only
        </span>
      </div>

      {visibleListState === 'loading' ? <ToolboxNotice icon={ClipboardCheck} title="Loading Toolbox Talks" message="Reading completed records for the verified company and Job." /> : null}
      {visibleListState === 'unavailable' ? <ToolboxNotice alert icon={ShieldCheck} title="Toolbox Talks unavailable" message="An authenticated company membership and verified Job are required." /> : null}
      {visibleListState === 'denied' ? <ToolboxNotice alert icon={ShieldCheck} title="Toolbox Talk access restricted" message="Supabase denied this company-and-Job read. No broader or privileged fallback was attempted." /> : null}
      {visibleListState === 'error' ? <ToolboxNotice alert icon={AlertTriangle} title="Toolbox Talks unavailable" message="Records could not be loaded. No previous-company or previous-Job records are displayed." /> : null}
      {visibleListState === 'empty' ? <ToolboxNotice icon={ClipboardCheck} title="No completed Toolbox Talks" message="No completed Toolbox Talks were found for this Job." /> : null}

      {visibleListState === 'ready' ? (
        <div className="mt-6 grid gap-3" aria-label="Toolbox Talk list">
          {visibleTalks.map(talk => (
            <article key={talk.id} className={`rounded-2xl border p-4 ${selectedTalkId === talk.id ? 'border-primary/50 bg-primary/5' : 'border-border bg-secondary/30'}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-black">{formatLocalDate(talk.local_date)}</h3>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-400">Completed</span>
                  </div>
                  <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatDateTime(talk.completed_at)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {talk.attendee_count} {talk.attendee_count === 1 ? 'attendee' : 'attendees'}
                    {talk.conducted_by_name ? ` · ${talk.conducted_by_name}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedTalkId(talk.id)}
                  className="min-h-11 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  View talk
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {visibleDetailState === 'loading' ? <ToolboxNotice icon={ClipboardCheck} title="Loading Toolbox Talk" message="Reading the selected immutable record and its approved child snapshots." /> : null}
      {visibleDetailState === 'unavailable' ? <ToolboxNotice alert icon={ShieldCheck} title="Toolbox Talk unavailable" message="The selected record is not available for this company and Job." /> : null}
      {visibleDetailState === 'denied' ? <ToolboxNotice alert icon={ShieldCheck} title="Toolbox Talk access restricted" message="Supabase denied this detail read. No fallback was attempted." /> : null}
      {visibleDetailState === 'error' ? <ToolboxNotice alert icon={AlertTriangle} title="Toolbox Talk details unavailable" message="The selected record could not be loaded safely." /> : null}
      {visibleDetailState === 'ready' && visibleDetail ? (
        <ToolboxTalkDetail talk={visibleDetail} onBack={() => setSelectedTalkId(null)} />
      ) : null}
    </section>
  );
}

const ToolboxTalkDetail = ({ talk, onBack }) => (
  <div className="mt-8 border-t border-border pt-6" aria-label={`Toolbox Talk for ${talk.job_name} on ${formatLocalDate(talk.local_date)}`}>
    <button
      type="button"
      onClick={onBack}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to Toolbox Talks
    </button>

    <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-black uppercase tracking-wider text-primary">Completed Toolbox Talk</p>
        <h3 className="mt-1 text-xl font-black">{talk.job_name}</h3>
        <p className="mt-1 text-xs text-muted-foreground">Job {talk.job_number} · {formatLocalDate(talk.local_date)}</p>
        {talk.job_address ? <p className="mt-1 text-xs text-muted-foreground">{talk.job_address}</p> : null}
      </div>
      <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-black uppercase text-emerald-400">Completed</span>
    </div>

    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      <DetailCard icon={UserRoundCheck} title="Responsible worker">
        <p>{talk.conducted_by_name ?? 'Not recorded'}</p>
        <p>{formatDateTime(talk.completed_at, talk.local_timezone)}</p>
      </DetailCard>
      <DetailCard icon={UsersRound} title="Attendees">
        {talk.attendees.length ? talk.attendees.map(attendee => (
          <p key={attendee.id}>{attendee.name} · {attendee.kind === 'member' ? 'Company member' : 'Visitor'}</p>
        )) : <p>No attendees recorded.</p>}
      </DetailCard>
    </div>

    <RecordSection title="Recorded daily questions">
      {talk.safety_questions.length ? talk.safety_questions.map(item => (
        <div key={`${item.number}:${item.question}`} className="rounded-xl bg-secondary/40 p-4">
          <p className="text-sm font-bold">{item.number}. {item.question}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{item.answer ?? 'Not recorded'}</p>
        </div>
      )) : <p className="text-sm text-muted-foreground">This older record has no daily-question snapshot. No details have been inferred.</p>}
    </RecordSection>

    <RecordSection title="Planned equipment">
      {talk.equipment.length ? talk.equipment.map(item => (
        <div key={item.id} className="rounded-xl bg-secondary/40 p-4">
          <p className="font-bold">{item.name} · {item.identifier}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.category ?? 'Category not recorded'} · Operator: {item.operator_name ?? 'Not assigned'}
          </p>
        </div>
      )) : <p className="text-sm text-muted-foreground">No planned equipment recorded.</p>}
      <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm leading-6 text-amber-100">
        <div className="flex items-center gap-2 font-black"><ShieldAlert className="h-4 w-4" aria-hidden="true" />Pre-Start status unavailable</div>
        <p className="mt-1 text-xs text-muted-foreground">Planned equipment is not proof of completed Pre-Starts, actual equipment use or permission to operate.</p>
      </div>
    </RecordSection>

    <RecordSection title="Additional recorded questions">
      {talk.questions.length ? talk.questions.map(question => (
        <div key={question.id} className="rounded-xl bg-secondary/40 p-4">
          <p className="text-sm font-bold">{question.question_text}{question.is_required ? ' *' : ''}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{formatAnswer(question.answer)}</p>
        </div>
      )) : <p className="text-sm text-muted-foreground">No additional questions were recorded.</p>}
    </RecordSection>
  </div>
);

const RecordSection = ({ title, children }) => (
  <section className="mt-5 rounded-2xl border border-border p-4" aria-label={title}>
    <h4 className="font-black">{title}</h4>
    <div className="mt-3 grid gap-3">{children}</div>
  </section>
);

const DetailCard = ({ icon: Icon, title, children }) => (
  <div className="rounded-2xl bg-secondary/40 p-4 text-sm">
    <div className="flex items-center gap-2 font-black">
      <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
      {title}
    </div>
    <div className="mt-2 space-y-1 break-words text-xs leading-5 text-muted-foreground">{children}</div>
  </div>
);

const ToolboxNotice = ({ icon: Icon, title, message, alert = false }) => (
  <div className={`mt-6 rounded-2xl border p-7 text-center ${alert ? 'border-amber-400/20 bg-amber-400/5' : 'border-border bg-secondary/30'}`} role={alert ? 'alert' : 'status'}>
    <Icon className={`mx-auto h-8 w-8 ${alert ? 'text-amber-400' : 'text-primary'}`} aria-hidden="true" />
    <h3 className="mt-3 font-black">{title}</h3>
    <p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{message}</p>
  </div>
);
