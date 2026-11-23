import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronRight, Clock3, History, Package, Search, ShieldCheck, UserRound, Wrench, X } from 'lucide-react';
import { onsiteApi } from '@/api/supabase/adapter';
import EquipmentPreStartHistory from '@/components/pre-starts/EquipmentPreStartHistory';
import { useAuth } from '@/lib/AuthContext';
import { useCompany } from '@/lib/companyContext';
import {
  createEquipmentScopeKey,
  equipmentCategoryLabel,
  equipmentHistoryActionLabel,
  equipmentStatusLabel,
  isEquipmentPermissionError,
  resolveEquipmentReadScope,
} from '@/lib/equipment-access';

const statusStyles = {
  available: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  checked_out: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  maintenance: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
};

const roleLabel = role => role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'Worker';
const formatTimestamp = value => {
  if (!value) return 'Not recorded';
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
};

export default function Equipment() {
  const { user } = useAuth();
  const { company, membership } = useCompany();
  const registerRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const historyRequestIdRef = useRef(0);
  const [tab, setTab] = useState('register');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [register, setRegister] = useState([]);
  const [registerScopeKey, setRegisterScopeKey] = useState(null);
  const [registerState, setRegisterState] = useState('loading');
  const [selectedEquipmentId, setSelectedEquipmentId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailResultKey, setDetailResultKey] = useState(null);
  const [detailState, setDetailState] = useState('idle');
  const [history, setHistory] = useState([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyScopeKey, setHistoryScopeKey] = useState(null);
  const [historyState, setHistoryState] = useState('idle');

  const equipmentScope = useMemo(() => resolveEquipmentReadScope({
    userId: user?.id,
    company,
    membership,
  }), [company, membership, user?.id]);
  const equipmentScopeKey = createEquipmentScopeKey(equipmentScope);
  const hasCurrentRegister = Boolean(equipmentScopeKey) && registerScopeKey === equipmentScopeKey;
  const visibleRegister = hasCurrentRegister ? register : [];
  const visibleRegisterState = !equipmentScope ? 'unavailable' : hasCurrentRegister ? registerState : 'loading';
  const selectedResultKey = selectedEquipmentId && equipmentScopeKey ? `${equipmentScopeKey}:${selectedEquipmentId}` : null;
  const visibleDetail = selectedResultKey && detailResultKey === selectedResultKey ? detail : null;
  const visibleDetailState = !selectedEquipmentId ? 'idle' : detailResultKey === selectedResultKey ? detailState : 'loading';
  const hasCurrentHistory = Boolean(equipmentScopeKey) && historyScopeKey === equipmentScopeKey;
  const visibleHistory = hasCurrentHistory ? history : [];
  const visibleHistoryState = !equipmentScope ? 'unavailable' : hasCurrentHistory ? historyState : 'loading';

  useEffect(() => {
    const requestId = registerRequestIdRef.current + 1;
    registerRequestIdRef.current = requestId;
    detailRequestIdRef.current += 1;
    historyRequestIdRef.current += 1;
    setRegister([]);
    setRegisterScopeKey(null);
    setSelectedEquipmentId(null);
    setDetail(null);
    setDetailResultKey(null);
    setDetailState('idle');
    setHistory([]);
    setHistoryScopeKey(null);
    setHistoryState('idle');

    if (!equipmentScope || !equipmentScopeKey) {
      setRegisterState('unavailable');
      return;
    }

    setRegisterState('loading');
    onsiteApi.equipmentRead.list(equipmentScope.companyId)
      .then(items => {
        if (requestId !== registerRequestIdRef.current) return;
        setRegister(items);
        setRegisterScopeKey(equipmentScopeKey);
        setRegisterState(items.length === 0 ? 'empty' : 'ready');
      })
      .catch(error => {
        if (requestId !== registerRequestIdRef.current) return;
        console.error('Failed to load Supabase equipment register:', error);
        setRegister([]);
        setRegisterScopeKey(equipmentScopeKey);
        setRegisterState(isEquipmentPermissionError(error) ? 'denied' : 'error');
      });

    return () => { registerRequestIdRef.current += 1; };
  }, [equipmentScope, equipmentScopeKey]);

  useEffect(() => {
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    setDetail(null);
    setDetailResultKey(null);

    if (!equipmentScope || !selectedEquipmentId || !selectedResultKey) {
      setDetailState('idle');
      return;
    }

    setDetailState('loading');
    onsiteApi.equipmentRead.get(equipmentScope.companyId, selectedEquipmentId)
      .then(item => {
        if (requestId !== detailRequestIdRef.current) return;
        setDetail(item);
        setDetailResultKey(selectedResultKey);
        setDetailState(item ? 'ready' : 'unavailable');
      })
      .catch(error => {
        if (requestId !== detailRequestIdRef.current) return;
        console.error('Failed to load Supabase equipment detail:', error);
        setDetail(null);
        setDetailResultKey(selectedResultKey);
        setDetailState(isEquipmentPermissionError(error) ? 'denied' : 'error');
      });

    return () => { detailRequestIdRef.current += 1; };
  }, [equipmentScope, selectedEquipmentId, selectedResultKey]);

  useEffect(() => {
    if (tab !== 'history') {
      historyRequestIdRef.current += 1;
      return;
    }

    const requestId = historyRequestIdRef.current + 1;
    historyRequestIdRef.current = requestId;
    setHistory([]);
    setHistoryHasMore(false);
    setHistoryScopeKey(null);

    if (!equipmentScope || !equipmentScopeKey) {
      setHistoryState('unavailable');
      return;
    }

    setHistoryState('loading');
    onsiteApi.equipmentRead.history({
      companyId: equipmentScope.companyId,
      userId: equipmentScope.userId,
      role: equipmentScope.role,
    })
      .then(result => {
        if (requestId !== historyRequestIdRef.current) return;
        setHistory(result.items);
        setHistoryHasMore(result.has_more);
        setHistoryScopeKey(equipmentScopeKey);
        setHistoryState(result.items.length === 0 ? 'empty' : 'ready');
      })
      .catch(error => {
        if (requestId !== historyRequestIdRef.current) return;
        console.error('Failed to load Supabase equipment history:', error);
        setHistory([]);
        setHistoryScopeKey(equipmentScopeKey);
        setHistoryState(isEquipmentPermissionError(error) ? 'denied' : 'error');
      });

    return () => { historyRequestIdRef.current += 1; };
  }, [equipmentScope, equipmentScopeKey, tab]);

  const filteredRegister = visibleRegister.filter(item => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || item.name.toLowerCase().includes(query) || item.equipment_id.toLowerCase().includes(query);
    return matchesSearch && (statusFilter === 'all' || item.status === statusFilter);
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-5 pb-24 pt-10 sm:px-8 lg:pb-12 lg:pt-16">
        <header className="rounded-3xl border border-border bg-card p-6 sm:p-8">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Wrench className="h-7 w-7" aria-hidden="true" /></span>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-primary">{equipmentScope?.companyName || 'Company workspace'}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Equipment</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {equipmentScope ? `Read-only register · Signed-in role: ${roleLabel(equipmentScope.role)}` : 'An active company workspace is required.'}
          </p>
        </header>

        <div className="mt-5 flex gap-2" role="tablist" aria-label="Equipment information">
          <TabButton active={tab === 'register'} onClick={() => setTab('register')} icon={Package} label="Register" />
          <TabButton active={tab === 'history'} onClick={() => setTab('history')} icon={History} label="History" />
        </div>

        {tab === 'register' ? (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
              <label className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">Search equipment</span>
                <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name or equipment ID" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
              </label>
              <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="Filter equipment status" className="rounded-2xl border border-border bg-card px-4 py-3 text-sm font-semibold outline-none">
                <option value="all">All statuses</option>
                <option value="available">Available</option>
                <option value="checked_out">Checked out</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
            <RegisterContent state={visibleRegisterState} items={filteredRegister} hasUnfilteredItems={visibleRegister.length > 0} onSelect={item => setSelectedEquipmentId(item.id)} />
          </>
        ) : (
          <HistoryContent state={visibleHistoryState} items={visibleHistory} hasMore={historyHasMore} role={equipmentScope?.role} />
        )}
      </div>

      {selectedEquipmentId && <EquipmentDetail state={visibleDetailState} item={visibleDetail} equipmentScope={equipmentScope} onClose={() => setSelectedEquipmentId(null)} />}
    </div>
  );
}

const TabButton = ({ active, onClick, icon: Icon, label }) => (
  <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold ${active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
    <Icon className="h-4 w-4" aria-hidden="true" />{label}
  </button>
);

const RegisterContent = ({ state, items, hasUnfilteredItems, onSelect }) => {
  if (state === 'loading') return <LoadingCards label="Loading equipment register" />;
  if (state === 'unavailable') return <Notice icon={ShieldCheck} title="Equipment register unavailable" message="Sign in and select an authorised company workspace before viewing its equipment." />;
  if (state === 'denied') return <Notice alert icon={ShieldCheck} title="Equipment access denied" message="Your current company role does not permit this register request." />;
  if (state === 'error') return <Notice alert icon={AlertTriangle} title="Equipment register unavailable" message="The register could not be loaded. No previous-company records are displayed." />;
  if (state === 'empty') return <Notice icon={Package} title="No active equipment found" message="The authorised company register returned no current equipment." />;
  if (items.length === 0 && hasUnfilteredItems) return <Notice icon={Search} title="No matching equipment" message="Try a different name, equipment ID or status filter." />;

  return (
    <section className="mt-5 grid gap-4 md:grid-cols-2" aria-label="Company equipment register">
      {items.map(item => (
        <button type="button" key={item.id} onClick={() => onSelect(item)} className="rounded-3xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Wrench className="h-6 w-6" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><h2 className="truncate text-lg font-black">{item.name}</h2><p className="mt-1 truncate text-sm text-muted-foreground">{item.equipment_id}</p></div>
                <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${statusStyles[item.status]}`}>{equipmentStatusLabel(item.status)}</span>
                <span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground">{equipmentCategoryLabel(item.category)}</span>
              </div>
            </div>
          </div>
        </button>
      ))}
    </section>
  );
};

const HistoryContent = ({ state, items, hasMore, role }) => {
  if (state === 'loading') return <LoadingCards label="Loading equipment history" />;
  if (state === 'unavailable') return <Notice icon={ShieldCheck} title="Equipment history unavailable" message="Sign in and select an authorised company workspace before viewing its history." />;
  if (state === 'denied') return <Notice alert icon={ShieldCheck} title="Equipment history denied" message="Your current company role does not permit this history request." />;
  if (state === 'error') return <Notice alert icon={AlertTriangle} title="Equipment history unavailable" message="Movement history could not be loaded. No previous-company records are displayed." />;
  if (state === 'empty') return <Notice icon={History} title="No equipment movements found" message="No visible equipment movement records were returned for this workspace." />;

  return (
    <section className="mt-5" aria-label="Equipment movement history">
      <p className="mb-4 text-sm text-muted-foreground">{role === 'worker' ? 'Your newest equipment movements.' : 'The company’s newest equipment movements.'}</p>
      <div className="space-y-3">
        {items.map(item => (
          <article key={item.id} className="rounded-3xl border border-border bg-card p-5">
            <div className="flex items-start gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Clock3 className="h-5 w-5" aria-hidden="true" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><h2 className="font-black">{item.equipment_name || 'Equipment name unavailable'}</h2><p className="mt-1 text-xs font-bold uppercase tracking-[0.14em] text-primary">{equipmentHistoryActionLabel(item.action)}</p></div>
                  <time className="text-xs text-muted-foreground" dateTime={item.timestamp}>{formatTimestamp(item.timestamp)}</time>
                </div>
                <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><UserRound className="h-4 w-4 shrink-0" aria-hidden="true" />{item.worker_name || 'Worker unavailable'}</p>
                {item.notes && <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">{item.notes}</p>}
              </div>
            </div>
          </article>
        ))}
      </div>
      {hasMore && <p className="mt-4 text-center text-xs text-muted-foreground">Showing the newest 25 movements.</p>}
    </section>
  );
};

const EquipmentDetail = ({ state, item, equipmentScope, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Equipment details" onClick={onClose}>
    <section className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-border bg-card p-6 sm:rounded-3xl" onClick={event => event.stopPropagation()}>
      <div className="flex items-center justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Read-only details</p><h2 className="mt-1 text-2xl font-black">{item?.name || 'Equipment'}</h2></div>
        <button type="button" onClick={onClose} aria-label="Close equipment details" className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground"><X className="h-5 w-5" aria-hidden="true" /></button>
      </div>
      {state === 'loading' ? (
        <div className="mt-6 h-48 animate-pulse rounded-2xl bg-secondary" aria-label="Loading equipment details" />
      ) : state !== 'ready' || !item ? (
        <div className="mt-6 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5" role="alert"><p className="font-bold">Equipment details unavailable</p><p className="mt-1 text-sm text-muted-foreground">The item is not available in the active company register.</p></div>
      ) : (
        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <DetailField label="Equipment ID" value={item.equipment_id} />
          <DetailField label="Category" value={equipmentCategoryLabel(item.category)} />
          <DetailField label="Status" value={equipmentStatusLabel(item.status)} />
          <DetailField label="Pre-start required" value={item.requires_pre_start ? 'Yes' : 'No'} />
          <DetailField label="Held by" value={item.checked_out_by_name || 'Not checked out'} />
          <DetailField label="Checked out at" value={formatTimestamp(item.checked_out_at)} />
          <DetailField label="Notes" value={item.notes || 'No notes recorded'} wide />
        </dl>
      )}
      {state === 'ready' && item ? <EquipmentPreStartHistory equipmentScope={equipmentScope} equipment={item} /> : null}
    </section>
  </div>
);

const DetailField = ({ label, value, wide = false }) => <div className={`rounded-2xl bg-secondary p-4 ${wide ? 'sm:col-span-2' : ''}`}><dt className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</dt><dd className="mt-2 break-words text-sm font-semibold">{value}</dd></div>;
const LoadingCards = ({ label }) => <section className="mt-5 grid gap-4 md:grid-cols-2" aria-label={label} aria-busy="true">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-36 animate-pulse rounded-3xl border border-border bg-card" />)}</section>;
const Notice = ({ icon: Icon, title, message, alert = false }) => <section className={`mt-5 rounded-3xl border bg-card p-8 text-center ${alert ? 'border-amber-400/20' : 'border-border'}`} role={alert ? 'alert' : 'status'}><Icon className={`mx-auto h-9 w-9 ${alert ? 'text-amber-400' : 'text-primary'}`} aria-hidden="true" /><h2 className="mt-4 text-xl font-black">{title}</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{message}</p></section>;
