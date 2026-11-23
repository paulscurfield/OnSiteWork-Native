import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Camera,
  ClipboardCheck,
  ShieldAlert,
  ShieldCheck,
  UserRoundCheck,
} from 'lucide-react';
import { onsiteApi } from '@/api/supabase/adapter';
import {
  createPreStartDetailRequestKey,
  createPreStartEquipmentScopeKey,
  isPreStartPermissionError,
  resolvePreStartEquipmentScope,
} from '@/lib/pre-start-access';

const STATUS_LABELS = { draft: 'Draft', submitted: 'Completed' };
const STATUS_STYLES = {
  draft: 'bg-amber-500/10 text-amber-400',
  submitted: 'bg-emerald-500/10 text-emerald-400',
};
const SAFETY_LABELS = {
  pending: 'Pending',
  safe: 'Safe when submitted',
  attention_required: 'Attention required',
  stood_down: 'Stood down',
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

const formatBytes = value => value < 1024
  ? `${value} B`
  : value < 1024 * 1024
    ? `${(value / 1024).toFixed(1)} KB`
    : `${(value / (1024 * 1024)).toFixed(1)} MB`;

export default function EquipmentPreStartHistory({ equipmentScope, equipment }) {
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [listState, setListState] = useState('loading');
  const [listResultKey, setListResultKey] = useState(null);
  const [selectedInspectionId, setSelectedInspectionId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailState, setDetailState] = useState('idle');
  const [detailResultKey, setDetailResultKey] = useState(null);

  const scope = useMemo(
    () => resolvePreStartEquipmentScope({ equipmentScope, equipment }),
    [equipment, equipmentScope],
  );
  const scopeKey = createPreStartEquipmentScopeKey(scope);
  const hasCurrentList = Boolean(scopeKey) && listResultKey === scopeKey;
  const visibleItems = hasCurrentList ? items : [];
  const visibleListState = !scope
    ? 'unavailable'
    : !scope.canReadCompanyHistory
      ? 'denied'
      : hasCurrentList
        ? listState
        : 'loading';
  const selectedSummary = selectedInspectionId
    ? visibleItems.find(item => item.id === selectedInspectionId) ?? null
    : null;
  const detailRequestKey = selectedSummary
    ? createPreStartDetailRequestKey(scope, selectedSummary.id)
    : null;
  const hasCurrentDetail = Boolean(detailRequestKey) && detailResultKey === detailRequestKey;
  const visibleDetail = hasCurrentDetail ? detail : null;
  const visibleDetailState = !selectedInspectionId
    ? 'idle'
    : !selectedSummary
      ? 'unavailable'
      : hasCurrentDetail
        ? detailState
        : 'loading';

  useEffect(() => {
    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    detailRequestRef.current += 1;
    setItems([]);
    setHasMore(false);
    setListResultKey(null);
    setSelectedInspectionId(null);
    setDetail(null);
    setDetailResultKey(null);

    if (!scope || !scopeKey || !scope.canReadCompanyHistory) {
      setListState(scope ? 'denied' : 'unavailable');
      return;
    }

    setListState('loading');
    onsiteApi.preStartsRead.listEquipmentHistory(scope)
      .then(result => {
        if (requestId !== listRequestRef.current) return;
        setItems(result.items);
        setHasMore(result.has_more);
        setListResultKey(scopeKey);
        setListState(result.items.length ? 'ready' : 'empty');
      })
      .catch(error => {
        if (requestId !== listRequestRef.current) return;
        console.error('Failed to load Supabase equipment Pre-Start history:', error);
        setItems([]);
        setListResultKey(scopeKey);
        setListState(isPreStartPermissionError(error) ? 'denied' : 'error');
      });

    return () => { listRequestRef.current += 1; };
  }, [scope, scopeKey]);

  useEffect(() => {
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    setDetail(null);
    setDetailResultKey(null);

    if (!scope || !scope.canReadCompanyHistory || !selectedSummary || !detailRequestKey) {
      setDetailState(selectedInspectionId ? 'unavailable' : 'idle');
      return;
    }

    setDetailState('loading');
    onsiteApi.preStartsRead.getEquipmentInspection(scope, selectedSummary.id)
      .then(result => {
        if (requestId !== detailRequestRef.current) return;
        setDetail(result);
        setDetailResultKey(detailRequestKey);
        setDetailState('ready');
      })
      .catch(error => {
        if (requestId !== detailRequestRef.current) return;
        console.error('Failed to load Supabase Pre-Start details:', error);
        setDetail(null);
        setDetailResultKey(detailRequestKey);
        setDetailState(isPreStartPermissionError(error) ? 'denied' : 'error');
      });

    return () => { detailRequestRef.current += 1; };
  }, [detailRequestKey, scope, selectedInspectionId, selectedSummary]);

  return (
    <section className="mt-6 border-t border-border pt-6" aria-label={`Pre-Start history for ${equipment.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Equipment Pre-Starts</p>
          <h3 className="mt-1 text-lg font-black">Inspection history</h3>
        </div>
        <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-primary">View only</span>
      </div>

      {visibleListState === 'loading' ? <Notice icon={ClipboardCheck} title="Loading Pre-Starts" message="Reading the first authorised history page for this Equipment." /> : null}
      {visibleListState === 'unavailable' ? <Notice alert icon={ShieldCheck} title="Pre-Start history unavailable" message="This record is not eligible machinery or a vehicle in the active workspace." /> : null}
      {visibleListState === 'denied' ? <Notice alert icon={ShieldCheck} title="Company history restricted" message="The backend exposes equipment history only to active Owners and Admins. Workers receive no broader fallback." /> : null}
      {visibleListState === 'error' ? <Notice alert icon={AlertTriangle} title="Pre-Start history unavailable" message="Records could not be loaded. No previous-company or previous-Equipment results are displayed." /> : null}
      {visibleListState === 'empty' ? <Notice icon={ClipboardCheck} title="No Pre-Starts found" message="No inspection records were returned for this Equipment." /> : null}

      {visibleListState === 'ready' ? (
        <div className="mt-5 space-y-3" aria-label="Equipment Pre-Start list">
          {visibleItems.map(item => (
            <article key={item.id} className={`rounded-2xl border p-4 ${selectedInspectionId === item.id ? 'border-primary/50 bg-primary/5' : 'border-border bg-secondary/30'}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-black">{formatLocalDate(item.local_date)}</h4>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${STATUS_STYLES[item.status]}`}>{STATUS_LABELS[item.status]}</span>
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">{item.is_primary ? 'Primary' : 'Additional'}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{item.inspector_display_name} · Recorded result: {SAFETY_LABELS[item.safety_status]}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.job_id ? `Job reference ${item.job_id}` : 'No Job recorded · Equipment-origin inspection'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.fault_count} {item.fault_count === 1 ? 'fault' : 'faults'} · {item.open_fault_count} open</p>
                </div>
                <button type="button" onClick={() => setSelectedInspectionId(item.id)} className="min-h-11 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">View inspection</button>
              </div>
            </article>
          ))}
          {hasMore ? <p className="text-center text-xs text-muted-foreground">Showing the newest 20 inspections. The backend supports cursor pagination; further pages are not exposed in this focused checkpoint.</p> : null}
        </div>
      ) : null}

      {visibleDetailState === 'loading' ? <Notice icon={ClipboardCheck} title="Loading inspection" message="Reading the exact inspection, immutable answer snapshots and authorised photo metadata." /> : null}
      {visibleDetailState === 'unavailable' ? <Notice alert icon={ShieldCheck} title="Inspection unavailable" message="The selected inspection is not present in the current Equipment history." /> : null}
      {visibleDetailState === 'denied' ? <Notice alert icon={ShieldCheck} title="Inspection access restricted" message="Supabase denied this exact detail read. No fallback was attempted." /> : null}
      {visibleDetailState === 'error' ? <Notice alert icon={AlertTriangle} title="Inspection details unavailable" message="The detail or its private photo metadata could not be validated safely." /> : null}
      {visibleDetailState === 'ready' && visibleDetail ? <InspectionDetail detail={visibleDetail} onBack={() => setSelectedInspectionId(null)} /> : null}
    </section>
  );
}

const InspectionDetail = ({ detail, onBack }) => {
  const { inspection, equipment, photos } = detail;
  const faultByQuestion = new Map(inspection.faults.map(fault => [fault.question_id, fault]));
  const photosByFault = new Map();
  photos.forEach(photo => photosByFault.set(photo.fault_id, [...(photosByFault.get(photo.fault_id) ?? []), photo]));
  const rows = inspection.status === 'submitted'
    ? inspection.answers.map(answer => ({ ...answer, fault: faultByQuestion.get(answer.question_id) ?? null }))
    : detail.template_questions.map(question => ({
      question_id: question.id,
      display_order: question.display_order,
      prompt: question.prompt,
      response_type: question.response_type,
      answer: inspection.draft_answers[question.id]?.answer ?? '',
      na_reason: inspection.draft_answers[question.id]?.na_reason ?? null,
      fault: null,
    }));

  return (
    <div className="mt-7 border-t border-border pt-6" aria-label={`Pre-Start inspection for ${equipment.name}`}>
      <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to inspection history
      </button>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-primary">{inspection.is_primary ? 'Primary inspection' : 'Approved additional inspection'}</p>
          <h4 className="mt-1 text-xl font-black">{equipment.name} · {equipment.identifier}</h4>
          <p className="mt-1 text-xs text-muted-foreground">{equipment.category === 'machinery' ? 'Machinery' : 'Vehicle'} · {formatLocalDate(inspection.local_date)}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${STATUS_STYLES[inspection.status]}`}>{STATUS_LABELS[inspection.status]}</span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <DetailCard icon={UserRoundCheck} title="Inspector">
          <p>{detail.inspector_display_name}</p>
          {detail.submitted_by_display_name ? <p>Submitted by {detail.submitted_by_display_name}</p> : <p>Not submitted</p>}
        </DetailCard>
        <DetailCard icon={CalendarDays} title="Recorded times">
          <p>Inspected: {formatDateTime(inspection.inspected_at)}</p>
          <p>{inspection.submitted_at ? `Submitted: ${formatDateTime(inspection.submitted_at)}` : 'Submission: not recorded'}</p>
        </DetailCard>
        <DetailCard icon={ShieldAlert} title="Recorded inspection result">
          <p>{SAFETY_LABELS[inspection.safety_status]}</p>
          <p>This is the saved inspection result, not a newly calculated operating-clearance decision.</p>
        </DetailCard>
        <DetailCard icon={ClipboardCheck} title="Associations">
          <p>{inspection.job_id ? `Job reference: ${inspection.job_id}` : 'No Job recorded (valid Equipment-origin inspection)'}</p>
          <p>{inspection.exceptional_reinspection_reason ? `Additional-inspection reason: ${inspection.exceptional_reinspection_reason}` : inspection.is_primary ? 'Daily primary record' : 'Reason not recorded'}</p>
        </DetailCard>
      </div>

      <div className="mt-5 space-y-3" aria-label="Pre-Start checklist answers">
        {rows.map(row => {
          const faultPhotos = row.fault ? photosByFault.get(row.fault.id) ?? [] : [];
          return (
            <article key={row.question_id} className="rounded-2xl border border-border bg-secondary/30 p-4">
              <p className="text-xs font-black uppercase tracking-wider text-primary">Question {row.display_order}</p>
              <h5 className="mt-2 text-sm font-black leading-6">{row.prompt}</h5>
              <p className="mt-3 rounded-xl bg-background/60 p-3 text-sm font-semibold">{row.answer || 'No answer saved'}</p>
              {row.answer === 'N/A' ? <p className="mt-2 text-xs font-bold text-amber-300">Not Applicable — not treated as a satisfactory answer</p> : null}
              {row.na_reason ? <p className="mt-1 text-xs text-muted-foreground">N/A note: {row.na_reason}</p> : null}
              {row.fault ? (
                <div className={`mt-3 rounded-xl border p-3 ${row.fault.severity === 'serious' ? 'border-rose-500/40 bg-rose-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
                  <p className="text-xs font-black uppercase">{row.fault.severity === 'serious' ? 'Serious safety fault' : 'Minor fault'}</p>
                  <p className="mt-2 text-sm">{row.fault.description}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Status: {row.fault.status.replaceAll('_', ' ')} · Notification recorded: {row.fault.notified ? 'Yes' : 'No'}</p>
                  {faultPhotos.map(photo => (
                    <p key={photo.photo_id} className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                      Private photo metadata · {photo.media_type} · {formatBytes(photo.file_size_bytes)} · {photo.upload_status}
                    </p>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
        {rows.length === 0 ? <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">No checklist answers are recorded for this inspection.</p> : null}
      </div>
      {photos.length ? <p className="mt-4 text-xs text-muted-foreground">Only authorised metadata is shown. No public or signed Storage image URL is requested.</p> : null}
    </div>
  );
};

const DetailCard = ({ icon: Icon, title, children }) => (
  <div className="rounded-2xl border border-border bg-secondary/30 p-4">
    <div className="flex items-center gap-2"><Icon className="h-4 w-4 text-primary" aria-hidden="true" /><h5 className="text-sm font-black">{title}</h5></div>
    <div className="mt-3 space-y-1 text-xs leading-5 text-muted-foreground">{children}</div>
  </div>
);

const Notice = ({ alert = false, icon: Icon, title, message }) => (
  <div className={`mt-5 rounded-2xl border p-5 ${alert ? 'border-amber-400/20 bg-amber-400/5' : 'border-border bg-secondary/30'}`} role={alert ? 'alert' : 'status'}>
    <Icon className={`h-6 w-6 ${alert ? 'text-amber-400' : 'text-primary'}`} aria-hidden="true" />
    <h4 className="mt-3 font-black">{title}</h4>
    <p className="mt-1 text-sm leading-6 text-muted-foreground">{message}</p>
  </div>
);
