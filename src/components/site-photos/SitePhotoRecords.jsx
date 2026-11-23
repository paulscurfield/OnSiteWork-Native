import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Camera,
  FileImage,
  ImageOff,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { onsiteApi } from '@/api/supabase/adapter';
import {
  createSitePhotoDetailKey,
  createSitePhotoScopeKey,
  isSitePhotoPermissionError,
  resolveSitePhotoReadScope,
} from '@/lib/site-photo-access';

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', worker: 'Worker' };

const formatDate = value => {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric', month: 'short', timeZone: 'UTC', year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

const formatDateTime = value => new Intl.DateTimeFormat('en-AU', {
  day: 'numeric', hour: 'numeric', minute: '2-digit', month: 'short',
  timeZone: 'Australia/Sydney', year: 'numeric',
}).format(new Date(value));

const formatFileSize = value => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const filtersKey = filters => `${filters.dateFrom || ''}:${filters.dateTo || ''}`;

export default function SitePhotoRecords({ jobScope, job }) {
  const listRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const imageRequestIdRef = useRef(0);
  const [photos, setPhotos] = useState([]);
  const [listState, setListState] = useState('loading');
  const [listResultKey, setListResultKey] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [draftFilters, setDraftFilters] = useState({ dateFrom: '', dateTo: '' });
  const [activeFilters, setActiveFilters] = useState({ dateFrom: null, dateTo: null });
  const [selectedPhotoId, setSelectedPhotoId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailState, setDetailState] = useState('idle');
  const [detailResultKey, setDetailResultKey] = useState(null);
  const [imageUrl, setImageUrl] = useState('');
  const [imageState, setImageState] = useState('idle');
  const [imageResultKey, setImageResultKey] = useState(null);

  const scope = useMemo(() => resolveSitePhotoReadScope({ jobScope, job }), [job, jobScope]);
  const scopeKey = createSitePhotoScopeKey(scope);
  const currentListKey = scopeKey ? `${scopeKey}:${filtersKey(activeFilters)}` : null;
  const hasCurrentList = Boolean(currentListKey) && listResultKey === currentListKey;
  const visiblePhotos = hasCurrentList ? photos : [];
  const visibleListState = !scope ? 'unavailable' : hasCurrentList ? listState : 'loading';
  const selectedSummary = selectedPhotoId
    ? visiblePhotos.find(photo => photo.id === selectedPhotoId) ?? null
    : null;
  const detailRequestKey = selectedSummary ? createSitePhotoDetailKey(scope, selectedSummary.id) : null;
  const hasCurrentDetail = Boolean(detailRequestKey) && detailResultKey === detailRequestKey;
  const visibleDetail = hasCurrentDetail ? detail : null;
  const visibleDetailState = !selectedPhotoId
    ? 'idle'
    : !selectedSummary
      ? 'unavailable'
      : hasCurrentDetail
        ? detailState
        : 'loading';
  const currentImageKey = visibleDetail
    ? `${detailRequestKey}:${visibleDetail.photo_path}:${visibleDetail.created_at}`
    : null;
  const visibleImageUrl = currentImageKey && imageResultKey === currentImageKey ? imageUrl : '';
  const visibleImageState = !visibleDetail
    ? 'idle'
    : currentImageKey && imageResultKey === currentImageKey
      ? imageState
      : 'loading';

  useEffect(() => {
    const requestId = listRequestIdRef.current + 1;
    listRequestIdRef.current = requestId;
    detailRequestIdRef.current += 1;
    imageRequestIdRef.current += 1;
    setPhotos([]);
    setListResultKey(null);
    setNextCursor(null);
    setHasMore(false);
    setLoadingMore(false);
    setSelectedPhotoId(null);
    setDetail(null);
    setDetailResultKey(null);
    setImageUrl('');
    setImageResultKey(null);

    if (!scope || !currentListKey) {
      setListState('unavailable');
      return;
    }

    setListState('loading');
    onsiteApi.sitePhotosRead.list(scope, activeFilters)
      .then(result => {
        if (requestId !== listRequestIdRef.current) return;
        setPhotos(result.items);
        setNextCursor(result.next_cursor);
        setHasMore(result.has_more);
        setListResultKey(currentListKey);
        setListState(result.items.length ? 'ready' : 'empty');
      })
      .catch(error => {
        if (requestId !== listRequestIdRef.current) return;
        console.error('Failed to load Supabase Site Photos metadata.');
        setPhotos([]);
        setListResultKey(currentListKey);
        setListState(isSitePhotoPermissionError(error) ? 'denied' : 'error');
      });

    return () => { listRequestIdRef.current += 1; };
  }, [activeFilters, currentListKey, scope]);

  useEffect(() => {
    const detailRequestId = detailRequestIdRef.current + 1;
    const imageRequestId = imageRequestIdRef.current + 1;
    detailRequestIdRef.current = detailRequestId;
    imageRequestIdRef.current = imageRequestId;
    setDetail(null);
    setDetailResultKey(null);
    setImageUrl('');
    setImageResultKey(null);

    if (!scope || !selectedSummary || !detailRequestKey) {
      setDetailState(selectedPhotoId ? 'unavailable' : 'idle');
      setImageState('idle');
      return;
    }

    setDetailState('loading');
    setImageState('idle');
    onsiteApi.sitePhotosRead.get(scope, selectedSummary.id)
      .then(result => {
        if (detailRequestId !== detailRequestIdRef.current) return;
        const nextImageKey = `${detailRequestKey}:${result.photo_path}:${result.created_at}`;
        setDetail(result);
        setDetailResultKey(detailRequestKey);
        setDetailState('ready');
        setImageState('loading');
        return onsiteApi.sitePhotosRead.createImageUrl(scope, result)
          .then(url => {
            if (imageRequestId !== imageRequestIdRef.current) return;
            setImageUrl(url);
            setImageResultKey(nextImageKey);
            setImageState('ready');
          })
          .catch(() => {
            if (imageRequestId !== imageRequestIdRef.current) return;
            setImageUrl('');
            setImageResultKey(nextImageKey);
            setImageState('unavailable');
          });
      })
      .catch(error => {
        if (detailRequestId !== detailRequestIdRef.current) return;
        console.error('Failed to load Supabase Site Photo detail.');
        setDetail(null);
        setDetailResultKey(detailRequestKey);
        setDetailState(isSitePhotoPermissionError(error) ? 'denied' : 'error');
        setImageState('idle');
      });

    return () => {
      detailRequestIdRef.current += 1;
      imageRequestIdRef.current += 1;
    };
  }, [detailRequestKey, scope, selectedPhotoId, selectedSummary]);

  const loadMore = () => {
    if (!scope || !hasCurrentList || !hasMore || !nextCursor || loadingMore) return;
    const requestId = listRequestIdRef.current + 1;
    listRequestIdRef.current = requestId;
    setLoadingMore(true);
    onsiteApi.sitePhotosRead.list(scope, { ...activeFilters, cursor: nextCursor })
      .then(result => {
        if (requestId !== listRequestIdRef.current) return;
        setPhotos(current => {
          const existingIds = new Set(current.map(photo => photo.id));
          return [...current, ...result.items.filter(photo => !existingIds.has(photo.id))];
        });
        setNextCursor(result.next_cursor);
        setHasMore(result.has_more);
      })
      .catch(error => {
        if (requestId !== listRequestIdRef.current) return;
        console.error('Failed to load another Site Photos page.');
        if (isSitePhotoPermissionError(error)) setListState('denied');
      })
      .finally(() => {
        if (requestId === listRequestIdRef.current) setLoadingMore(false);
      });
  };

  const applyDateFilters = event => {
    event.preventDefault();
    if (draftFilters.dateFrom && draftFilters.dateTo && draftFilters.dateTo < draftFilters.dateFrom) return;
    setActiveFilters({
      dateFrom: draftFilters.dateFrom || null,
      dateTo: draftFilters.dateTo || null,
    });
  };

  return (
    <section className="min-w-0 rounded-3xl border border-border bg-card p-6 sm:p-8" aria-label="Site Photo records">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <Camera className="h-5 w-5" aria-hidden="true" />
            <p className="text-xs font-black uppercase tracking-[0.16em]">Private job photo library</p>
          </div>
          <h2 className="mt-3 text-xl font-black">Site Photos</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {scope ? `${scope.jobName} · ${ROLE_LABELS[scope.role]}` : 'Verified job access required'}
          </p>
        </div>
        <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-primary">View only</span>
      </div>

      <form onSubmit={applyDateFilters} className="mt-5 grid gap-3 rounded-2xl border border-border bg-secondary/30 p-4 sm:grid-cols-[1fr_1fr_auto]" aria-label="Site Photo date filters">
        <label className="text-xs font-bold text-muted-foreground">
          From date
          <input type="date" value={draftFilters.dateFrom} onChange={event => setDraftFilters(current => ({ ...current, dateFrom: event.target.value }))} className="mt-2 min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground" />
        </label>
        <label className="text-xs font-bold text-muted-foreground">
          To date
          <input type="date" value={draftFilters.dateTo} onChange={event => setDraftFilters(current => ({ ...current, dateTo: event.target.value }))} className="mt-2 min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground" />
        </label>
        <button type="submit" className="min-h-11 self-end rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Apply dates</button>
      </form>
      {draftFilters.dateFrom && draftFilters.dateTo && draftFilters.dateTo < draftFilters.dateFrom ? (
        <p className="mt-2 text-xs font-semibold text-amber-400" role="alert">The end date must be on or after the start date.</p>
      ) : null}

      {visibleListState === 'loading' ? <PhotoNotice icon={Camera} title="Loading Site Photos" message="Reading the first authorised metadata page for the verified company and Job." /> : null}
      {visibleListState === 'unavailable' ? <PhotoNotice alert icon={ShieldCheck} title="Site Photos unavailable" message="An authenticated company membership and verified Job are required." /> : null}
      {visibleListState === 'denied' ? <PhotoNotice alert icon={ShieldCheck} title="Site Photo access restricted" message="Supabase denied this company-and-Job read. No broader or privileged fallback was attempted." /> : null}
      {visibleListState === 'error' ? <PhotoNotice alert icon={AlertTriangle} title="Site Photos unavailable" message="Photo metadata could not be loaded. No previous-company or previous-Job records are displayed." /> : null}
      {visibleListState === 'empty' ? <PhotoNotice icon={ImageOff} title="No Site Photos" message="No matching Site Photos are recorded for this Job and date range." /> : null}

      {visibleListState === 'ready' ? (
        <div className="mt-6 grid gap-3" aria-label="Site Photo list">
          {visiblePhotos.map(photo => (
            <article key={photo.id} className={`rounded-2xl border p-4 ${selectedPhotoId === photo.id ? 'border-primary/50 bg-primary/5' : 'border-border bg-secondary/30'}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-black">{formatDate(photo.date)}</h3>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-400">Job Site Photo</span>
                  </div>
                  <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><UserRound className="h-3.5 w-3.5" aria-hidden="true" />{photo.worker_name}</p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />Uploaded {formatDateTime(photo.uploaded_at)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{photo.notes || 'No caption recorded'} · {formatFileSize(photo.file_size_bytes)}</p>
                </div>
                <button type="button" onClick={() => setSelectedPhotoId(photo.id)} className="min-h-11 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">View photo</button>
              </div>
            </article>
          ))}
          {hasMore ? (
            <button type="button" disabled={loadingMore} onClick={loadMore} className="min-h-11 rounded-xl border border-border px-4 text-sm font-bold text-foreground disabled:opacity-60">
              {loadingMore ? 'Loading more…' : 'Load more Site Photos'}
            </button>
          ) : null}
        </div>
      ) : null}

      {visibleDetailState === 'loading' ? <PhotoNotice icon={FileImage} title="Loading Site Photo" message="Reading the exact authorised metadata record before requesting a short-lived private image URL." /> : null}
      {visibleDetailState === 'unavailable' ? <PhotoNotice alert icon={ShieldCheck} title="Site Photo unavailable" message="The selected photo is not available for this company and Job." /> : null}
      {visibleDetailState === 'denied' ? <PhotoNotice alert icon={ShieldCheck} title="Site Photo access restricted" message="Supabase denied this detail read. No fallback was attempted." /> : null}
      {visibleDetailState === 'error' ? <PhotoNotice alert icon={AlertTriangle} title="Site Photo details unavailable" message="The selected photo record could not be loaded safely." /> : null}
      {visibleDetailState === 'ready' && visibleDetail ? (
        <PhotoDetail
          photo={visibleDetail}
          imageState={visibleImageState}
          imageUrl={visibleImageUrl}
          onBack={() => setSelectedPhotoId(null)}
        />
      ) : null}
    </section>
  );
}

const PhotoDetail = ({ photo, imageState, imageUrl, onBack }) => (
  <div className="mt-8 border-t border-border pt-6" aria-label={`Site Photo from ${formatDate(photo.date)}`}>
    <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to Site Photos
    </button>
    <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-secondary/30">
      {imageState === 'ready' && imageUrl ? <img src={imageUrl} alt={`Site Photo uploaded by ${photo.worker_name} on ${formatDate(photo.date)}`} className="max-h-[34rem] w-full bg-black/20 object-contain" /> : null}
      {imageState === 'loading' ? <div className="flex min-h-64 items-center justify-center p-6 text-sm font-semibold text-muted-foreground" role="status">Opening private image preview…</div> : null}
      {imageState === 'unavailable' ? <div className="flex min-h-64 flex-col items-center justify-center gap-2 p-6 text-center"><ImageOff className="h-8 w-8 text-primary" aria-hidden="true" /><p className="font-black">Image preview unavailable</p><p className="max-w-lg text-xs leading-5 text-muted-foreground">The private object could not be authorised or retrieved. Its metadata remains available; no public URL was generated.</p></div> : null}
      <div className="grid gap-3 border-t border-border p-5 sm:grid-cols-2">
        <PhotoField label="Recorded date" value={formatDate(photo.date)} />
        <PhotoField label="Uploader" value={photo.worker_name} />
        <PhotoField label="Uploaded" value={formatDateTime(photo.uploaded_at)} />
        <PhotoField label="Captured" value={photo.captured_at ? formatDateTime(photo.captured_at) : 'Not recorded'} />
        <PhotoField label="File" value={`${photo.media_type} · ${formatFileSize(photo.file_size_bytes)}`} />
        <PhotoField label="Dimensions" value={photo.image_width ? `${photo.image_width} × ${photo.image_height}` : 'Not recorded'} />
        <PhotoField label="Caption" value={photo.notes || 'No caption recorded'} wide />
        <PhotoField label="Delivery association" value="Not exposed by the approved Site Photos read contract" wide />
      </div>
    </div>
  </div>
);

const PhotoField = ({ label, value, wide = false }) => (
  <div className={wide ? 'sm:col-span-2' : ''}>
    <p className="text-[10px] font-black uppercase tracking-wider text-primary">{label}</p>
    <p className="mt-1 text-sm leading-6 text-foreground">{value}</p>
  </div>
);

const PhotoNotice = ({ alert = false, icon: Icon, message, title }) => (
  <div className={`mt-6 rounded-2xl border p-5 ${alert ? 'border-amber-400/20 bg-amber-400/5' : 'border-border bg-secondary/30'}`} role={alert ? 'alert' : 'status'}>
    <Icon className={`h-6 w-6 ${alert ? 'text-amber-400' : 'text-primary'}`} aria-hidden="true" />
    <h3 className="mt-3 font-black">{title}</h3>
    <p className="mt-1 text-sm leading-6 text-muted-foreground">{message}</p>
  </div>
);
