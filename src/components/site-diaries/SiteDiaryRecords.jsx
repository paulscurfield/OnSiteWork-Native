import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  ClipboardList,
  CloudSun,
  PackageCheck,
  ShieldCheck,
  Truck,
  UserRoundCheck,
  UsersRound,
  Wrench,
} from 'lucide-react';
import { onsiteApi } from '@/api/supabase/adapter';
import {
  createSiteDiaryRequestKey,
  createSiteDiaryScopeKey,
  isSiteDiaryPermissionError,
  resolveSiteDiaryReadScope,
} from '@/lib/site-diary-access';

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', worker: 'Worker' };
const STATUS_LABELS = { draft: 'Draft', completed: 'Completed' };
const STATUS_STYLES = {
  draft: 'bg-amber-500/10 text-amber-400',
  completed: 'bg-emerald-500/10 text-emerald-400',
};

const formatLocalDate = value => {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric', month: 'short', timeZone: 'UTC', year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

const formatDateTime = value => new Intl.DateTimeFormat('en-AU', {
  day: 'numeric', hour: 'numeric', minute: '2-digit', month: 'short',
  timeZone: 'Australia/Sydney', year: 'numeric',
}).format(new Date(value));

const recordedText = value => value || 'Not recorded';

export default function SiteDiaryRecords({ jobScope, job }) {
  const listRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const [diaries, setDiaries] = useState([]);
  const [listState, setListState] = useState('loading');
  const [resultScopeKey, setResultScopeKey] = useState(null);
  const [selectedDiaryId, setSelectedDiaryId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailState, setDetailState] = useState('idle');
  const [detailResultKey, setDetailResultKey] = useState(null);

  const scope = useMemo(() => resolveSiteDiaryReadScope({ jobScope, job }), [job, jobScope]);
  const scopeKey = createSiteDiaryScopeKey(scope);
  const hasCurrentList = Boolean(scopeKey) && resultScopeKey === scopeKey;
  const visibleDiaries = hasCurrentList ? diaries : [];
  const visibleListState = !scope ? 'unavailable' : hasCurrentList ? listState : 'loading';
  const selectedSummary = selectedDiaryId
    ? visibleDiaries.find(diary => diary.id === selectedDiaryId) ?? null
    : null;
  const detailRequestKey = selectedSummary
    ? createSiteDiaryRequestKey(scope, selectedSummary.id, selectedSummary.local_date)
    : null;
  const hasCurrentDetail = Boolean(detailRequestKey) && detailResultKey === detailRequestKey;
  const visibleDetail = hasCurrentDetail ? detail : null;
  const visibleDetailState = !selectedDiaryId
    ? 'idle'
    : !selectedSummary
      ? 'unavailable'
      : hasCurrentDetail
        ? detailState
        : 'loading';

  useEffect(() => {
    const requestId = listRequestIdRef.current + 1;
    listRequestIdRef.current = requestId;
    setDiaries([]);
    setResultScopeKey(null);
    setSelectedDiaryId(null);
    setDetail(null);
    setDetailResultKey(null);

    if (!scope || !scopeKey) {
      setListState('unavailable');
      return;
    }

    setListState('loading');
    onsiteApi.siteDiariesRead.list(scope)
      .then(result => {
        if (requestId !== listRequestIdRef.current) return;
        setDiaries(result);
        setResultScopeKey(scopeKey);
        setListState(result.length ? 'ready' : 'empty');
      })
      .catch(error => {
        if (requestId !== listRequestIdRef.current) return;
        console.error('Failed to load Supabase Site Diaries:', error);
        setDiaries([]);
        setResultScopeKey(scopeKey);
        setListState(isSiteDiaryPermissionError(error) ? 'denied' : 'error');
      });

    return () => { listRequestIdRef.current += 1; };
  }, [scope, scopeKey]);

  useEffect(() => {
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    setDetail(null);
    setDetailResultKey(null);

    if (!scope || !selectedSummary || !detailRequestKey) {
      setDetailState(selectedDiaryId ? 'unavailable' : 'idle');
      return;
    }

    setDetailState('loading');
    onsiteApi.siteDiariesRead.get(scope, selectedSummary.id, selectedSummary.local_date)
      .then(result => {
        if (requestId !== detailRequestIdRef.current) return;
        setDetail(result);
        setDetailResultKey(detailRequestKey);
        setDetailState('ready');
      })
      .catch(error => {
        if (requestId !== detailRequestIdRef.current) return;
        console.error('Failed to load Supabase Site Diary details:', error);
        setDetail(null);
        setDetailResultKey(detailRequestKey);
        setDetailState(isSiteDiaryPermissionError(error) ? 'denied' : 'error');
      });

    return () => { detailRequestIdRef.current += 1; };
  }, [detailRequestKey, scope, selectedDiaryId, selectedSummary]);

  return (
    <section className="min-w-0 rounded-3xl border border-border bg-card p-6 sm:p-8" aria-label="Site Diary records">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <ClipboardList className="h-5 w-5" aria-hidden="true" />
            <p className="text-xs font-black uppercase tracking-[0.16em]">Read-only daily records</p>
          </div>
          <h2 className="mt-3 text-xl font-black">Site Diaries</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {scope ? `${scope.jobName} · ${ROLE_LABELS[scope.role]}` : 'Verified job access required'}
          </p>
        </div>
        <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-primary">View only</span>
      </div>

      {visibleListState === 'loading' ? <DiaryNotice icon={ClipboardList} title="Loading Site Diaries" message="Reading the first authorised history page for the verified company and Job." /> : null}
      {visibleListState === 'unavailable' ? <DiaryNotice alert icon={ShieldCheck} title="Site Diaries unavailable" message="An authenticated company membership and verified Job are required." /> : null}
      {visibleListState === 'denied' ? <DiaryNotice alert icon={ShieldCheck} title="Site Diary access restricted" message="Supabase denied this company-and-Job read. No broader or privileged fallback was attempted." /> : null}
      {visibleListState === 'error' ? <DiaryNotice alert icon={AlertTriangle} title="Site Diaries unavailable" message="Records could not be loaded. No previous-company or previous-Job records are displayed." /> : null}
      {visibleListState === 'empty' ? <DiaryNotice icon={ClipboardList} title="No Site Diaries" message="No Site Diaries have been started for this Job." /> : null}

      {visibleListState === 'ready' ? (
        <div className="mt-6 grid gap-3" aria-label="Site Diary list">
          {visibleDiaries.map(diary => (
            <article key={diary.id} className={`rounded-2xl border p-4 ${selectedDiaryId === diary.id ? 'border-primary/50 bg-primary/5' : 'border-border bg-secondary/30'}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-black">{formatLocalDate(diary.local_date)}</h3>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${STATUS_STYLES[diary.status]}`}>{STATUS_LABELS[diary.status]}</span>
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">{diary.is_primary ? 'Primary' : 'Additional'}</span>
                  </div>
                  <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                    Updated {formatDateTime(diary.updated_at)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {diary.owner_id === scope.userId ? 'Your diary' : 'Recorded by another authorised member'} · Revision {diary.revision}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedDiaryId(diary.id)}
                  className="min-h-11 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  View diary
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {visibleDetailState === 'loading' ? <DiaryNotice icon={ClipboardList} title="Loading Site Diary" message="Reading the exact diary and shared Job deliveries for its Australian local date." /> : null}
      {visibleDetailState === 'unavailable' ? <DiaryNotice alert icon={ShieldCheck} title="Site Diary unavailable" message="The selected diary is not available for this company and Job." /> : null}
      {visibleDetailState === 'denied' ? <DiaryNotice alert icon={ShieldCheck} title="Site Diary access restricted" message="Supabase denied this detail read. No fallback was attempted." /> : null}
      {visibleDetailState === 'error' ? <DiaryNotice alert icon={AlertTriangle} title="Site Diary details unavailable" message="The selected diary or its authorised delivery projection could not be loaded safely." /> : null}
      {visibleDetailState === 'ready' && visibleDetail ? (
        <SiteDiaryDetail scope={scope} record={visibleDetail} onBack={() => setSelectedDiaryId(null)} />
      ) : null}
    </section>
  );
}

const SiteDiaryDetail = ({ scope, record, onBack }) => {
  const { diary, deliveries } = record;
  return (
    <div className="mt-8 border-t border-border pt-6" aria-label={`Site Diary for ${scope.jobName} on ${formatLocalDate(diary.local_date)}`}>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Site Diaries
      </button>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-primary">{diary.is_primary ? 'Primary Site Diary' : 'Additional Site Diary'}</p>
          <h3 className="mt-1 text-xl font-black">{scope.jobName}</h3>
          <p className="mt-1 text-xs text-muted-foreground">Job {scope.jobNumber} · {formatLocalDate(diary.local_date)}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${STATUS_STYLES[diary.status]}`}>{STATUS_LABELS[diary.status]}</span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <DetailCard icon={UserRoundCheck} title="Diary ownership">
          <p>{diary.owner_id === scope.userId ? 'Owned by you' : 'Owned by another authorised member'}</p>
          <p>The job read contract does not include the foreman’s display name.</p>
        </DetailCard>
        <DetailCard icon={CalendarDays} title="Record timestamps">
          <p>Created: {formatDateTime(diary.created_at)}</p>
          <p>Updated: {formatDateTime(diary.updated_at)}</p>
          {diary.completed_at ? <p>Completed: {formatDateTime(diary.completed_at)}</p> : <p>Not completed</p>}
          {diary.corrected_at ? <p>Corrected: {formatDateTime(diary.corrected_at)}</p> : null}
        </DetailCard>
      </div>

      <RecordSection icon={ClipboardList} title="Work performed and progress">
        <RecordedValue label="Work completed" value={diary.work_completed_today} />
        <RecordedValue label="Materials used" value={diary.materials_used} />
        <RecordedValue label="General notes" value={diary.general_notes} />
      </RecordSection>

      <RecordSection icon={CloudSun} title="Weather and site conditions">
        <RecordedValue label="Weather conditions" value={diary.weather_conditions} />
      </RecordSection>

      <RecordSection icon={UsersRound} title="Workers on site">
        {diary.workers_on_site.length ? diary.workers_on_site.map((worker, index) => (
          <div key={`${worker.kind}:${worker.member_user_id ?? index}:${worker.display_name}`} className="rounded-xl bg-secondary/40 p-4">
            <p className="font-bold">{worker.display_name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {worker.kind === 'member' ? 'Company member' : worker.kind === 'visitor' ? 'Visitor' : 'Manually recorded worker'}
              {worker.source_toolbox_talk_ids.length ? ` · Confirmed from ${worker.source_toolbox_talk_ids.length} Toolbox Talk ${worker.source_toolbox_talk_ids.length === 1 ? 'reference' : 'references'}` : ''}
            </p>
          </div>
        )) : <p className="text-sm text-muted-foreground">No workers were recorded on this diary.</p>}
      </RecordSection>

      <RecordSection icon={Wrench} title="Equipment actually used">
        {diary.equipment_used.length ? diary.equipment_used.map((item, index) => (
          <div key={`${item.equipment_id ?? index}:${item.identifier}`} className="rounded-xl bg-secondary/40 p-4">
            <p className="font-bold">{item.name} · {item.identifier}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {item.category ?? 'Category not recorded'}
              {item.source_toolbox_talk_ids.length ? ` · Confirmed diary entry with ${item.source_toolbox_talk_ids.length} Toolbox Talk ${item.source_toolbox_talk_ids.length === 1 ? 'reference' : 'references'}` : ' · Confirmed directly in this diary'}
            </p>
          </div>
        )) : <p className="text-sm text-muted-foreground">No actual equipment use was recorded.</p>}
      </RecordSection>

      <RecordSection icon={AlertTriangle} title="Visitors, incidents and delays">
        <RecordedValue label="Visitors / inspections" value={diary.visitors_inspections} />
        <RecordedValue label="Incidents / near misses" value={diary.incidents_near_misses} />
        <RecordedValue label="Delays / issues" value={diary.delays_issues} />
      </RecordSection>

      <RecordSection icon={Truck} title="Shared Job deliveries for this date">
        {deliveries.length ? deliveries.map(delivery => (
          <div key={delivery.id} className="rounded-xl bg-secondary/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-bold">{delivery.item_description} · {delivery.quantity}</p>
              <span className="text-xs text-muted-foreground">{formatDateTime(delivery.delivered_at)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{delivery.supplier ?? 'Supplier not recorded'} · Recorded by {delivery.created_by_display_name}</p>
            {delivery.notes ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{delivery.notes}</p> : null}
            <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {delivery.photo_ids.length} linked Site {delivery.photo_ids.length === 1 ? 'Photo' : 'Photos'} — metadata only
            </p>
          </div>
        )) : <p className="text-sm text-muted-foreground">No deliveries were recorded for this Job and date.</p>}
        <p className="text-xs leading-5 text-muted-foreground">Deliveries are shared across same-date diaries. No Storage URL or structured Purchase Order reference is supplied by this read contract.</p>
      </RecordSection>
    </div>
  );
};

const RecordedValue = ({ label, value }) => (
  <div className="rounded-xl bg-secondary/40 p-4">
    <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{recordedText(value)}</p>
  </div>
);

const RecordSection = ({ icon: Icon, title, children }) => (
  <section className="mt-5 rounded-2xl border border-border p-4" aria-label={title}>
    <h4 className="flex items-center gap-2 font-black"><Icon className="h-4 w-4 text-primary" aria-hidden="true" />{title}</h4>
    <div className="mt-3 grid gap-3">{children}</div>
  </section>
);

const DetailCard = ({ icon: Icon, title, children }) => (
  <div className="rounded-2xl bg-secondary/40 p-4 text-sm">
    <div className="flex items-center gap-2 font-black"><Icon className="h-4 w-4 text-primary" aria-hidden="true" />{title}</div>
    <div className="mt-2 space-y-1 break-words text-xs leading-5 text-muted-foreground">{children}</div>
  </div>
);

const DiaryNotice = ({ icon: Icon, title, message, alert = false }) => (
  <div className={`mt-6 rounded-2xl border p-7 text-center ${alert ? 'border-amber-400/20 bg-amber-400/5' : 'border-border bg-secondary/30'}`} role={alert ? 'alert' : 'status'}>
    <Icon className={`mx-auto h-8 w-8 ${alert ? 'text-amber-400' : 'text-primary'}`} aria-hidden="true" />
    <h3 className="mt-3 font-black">{title}</h3>
    <p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{message}</p>
  </div>
);
