import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Camera, Loader2, Image, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { onsiteApi } from '@/api/supabase/adapter';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const requireSupabaseUuid = (value, label) => {
  const trimmed = String(value || '').trim();
  if (!UUID_PATTERN.test(trimmed)) {
    throw new Error(`${label} must be a valid Supabase UUID.`);
  }
  return trimmed;
};

const resolveSingleCompany = (profile, companyRows) => {
  if (!profile?.id) {
    throw new Error('You must be signed in to upload site photos.');
  }
  if (companyRows.length === 0) {
    throw new Error('No Supabase company is available for this account.');
  }
  if (companyRows.length > 1) {
    throw new Error('Multiple Supabase companies found. Company selection is required before uploading site photos.');
  }
  return companyRows[0];
};

export default function SitePhotos() {
  const loadRequestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const uploadingRef = useRef(false);
  const [supabaseCompany, setSupabaseCompany] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const fileInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;

    const init = async () => {
      setLoading(true);
      setLoadError('');
      setSupabaseCompany(null);
      setJobs([]);
      setSelectedJobId('');

      try {
        const [profile, companyRows] = await Promise.all([
          onsiteApi.auth.me(),
          onsiteApi.tables.companies.list('name'),
        ]);
        if (requestId !== loadRequestIdRef.current) return;

        const resolvedCompany = resolveSingleCompany(profile, companyRows);
        const memberRows = await onsiteApi.tables.companyMembers.filter({
          company_id: resolvedCompany.id,
          user_id: profile.id,
        });
        if (requestId !== loadRequestIdRef.current) return;

        if (!memberRows[0]) {
          throw new Error('Your Supabase company membership could not be confirmed.');
        }

        const activeJobs = await onsiteApi.tables.jobs.filter({
          company_id: resolvedCompany.id,
          status: 'active',
        });
        if (requestId !== loadRequestIdRef.current) return;

        setSupabaseCompany(resolvedCompany);
        setJobs(activeJobs);
      } catch (error) {
        if (requestId !== loadRequestIdRef.current) return;
        console.error('Failed to load Supabase site photos page:', error);
        setLoadError(error?.message || 'Failed to load Site Photos.');
        setSupabaseCompany(null);
        setJobs([]);
        setSelectedJobId('');
      } finally {
        if (requestId === loadRequestIdRef.current) {
          setLoading(false);
        }
      }
    };

    init();
    return () => {
      loadRequestIdRef.current += 1;
    };
  }, []);

  const resetInput = (event) => {
    if (event?.target) {
      event.target.value = '';
    }
  };

  const resolveExactJob = async (companyId, jobId) => {
    const safeJobId = requireSupabaseUuid(jobId, 'Job ID');
    const jobRows = await onsiteApi.tables.jobs.filter({
      company_id: companyId,
      id: safeJobId,
    });
    const resolvedJob = jobRows[0] || null;
    if (!resolvedJob) {
      throw new Error('Selected job is unavailable. Select a job or clock in before uploading a photo.');
    }
    return resolvedJob;
  };

  const resolveUploadJob = async () => {
    if (!supabaseCompany) {
      throw new Error('Site Photos is not ready to upload.');
    }

    if (selectedJobId) {
      return resolveExactJob(supabaseCompany.id, selectedJobId);
    }

    const activeEntry = await onsiteApi.tables.timeEntries.getMyActive(supabaseCompany.id);
    if (!activeEntry?.job_id) {
      throw new Error('Select a job or clock in before uploading a photo.');
    }
    return resolveExactJob(supabaseCompany.id, activeEntry.job_id);
  };

  const handleCapture = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      resetInput(event);
      return;
    }
    if (uploadingRef.current) {
      resetInput(event);
      return;
    }
    if (loading || loadError || !supabaseCompany) {
      toast.error('Site Photos is not ready to upload.');
      resetInput(event);
      return;
    }

    uploadingRef.current = true;
    setUploading(true);

    try {
      const resolvedJob = await resolveUploadJob();
      await onsiteApi.tables.jobPhotos.createWorker({
        company_id: supabaseCompany.id,
        job_id: resolvedJob['id'],
        date: format(new Date(), 'yyyy-MM-dd'),
        notes,
        file,
      });

      if (!mountedRef.current) return;
      setNotes('');
      toast.success('Photo uploaded!');
    } catch (error) {
      if (!mountedRef.current) return;
      console.error('Failed to upload Supabase site photo:', error);
      toast.error(error?.message || 'Failed to upload photo');
    } finally {
      uploadingRef.current = false;
      resetInput(event);
      if (mountedRef.current) {
        setUploading(false);
      }
    }
  };

  const pageReady = !loading && !loadError && Boolean(supabaseCompany);

  return (
    <div className="min-h-screen bg-background">
      <div className="px-6 pt-14 pb-4 flex items-center gap-4">
        <Link to="/" className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-black flex-1">Site Photos</h1>
      </div>

      <div className="px-6 space-y-4">
        {loading || loadError ? (
          <div className="bg-card border border-border rounded-2xl p-6 flex flex-col items-center text-center">
            {loading ? (
              <>
                <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                <p className="text-sm text-muted-foreground">Loading Site Photos...</p>
              </>
            ) : (
              <>
                <AlertTriangle className="w-8 h-8 text-red-400 mb-4" />
                <p className="font-bold text-sm mb-2">Site Photos unavailable</p>
                <p className="text-sm text-muted-foreground max-w-sm">{loadError}</p>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
              <p className="text-sm font-semibold text-muted-foreground">Select Job Site (optional — auto-detects if clocked in)</p>
              <select
                value={selectedJobId}
                onChange={event => setSelectedJobId(event.target.value)}
                className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Auto-detect from clock-in</option>
                {jobs.map(job => (
                  <option key={job.id} value={job.id}>{job.job_name} #{job.job_number}</option>
                ))}
              </select>
              <input
                value={notes}
                onChange={event => setNotes(event.target.value)}
                placeholder="Add a note (optional)..."
                className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
              />
            </div>

            {/* Camera + Gallery Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || !pageReady}
                className="py-6 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 flex flex-col items-center gap-3 transition-all active:scale-95 disabled:opacity-60"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="font-bold text-primary text-sm">Uploading...</p>
                  </>
                ) : (
                  <>
                    <Camera className="w-8 h-8 text-primary" />
                    <p className="font-black text-primary">Take Photo</p>
                    <p className="text-xs text-muted-foreground text-center">Use camera</p>
                  </>
                )}
              </button>

              <button
                onClick={() => galleryInputRef.current?.click()}
                disabled={uploading || !pageReady}
                className="py-6 rounded-2xl border-2 border-dashed border-accent/40 bg-accent/5 flex flex-col items-center gap-3 transition-all active:scale-95 disabled:opacity-60"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-8 h-8 text-accent animate-spin" />
                    <p className="font-bold text-accent text-sm">Uploading...</p>
                  </>
                ) : (
                  <>
                    <Image className="w-8 h-8 text-accent" />
                    <p className="font-black text-accent">Choose Photo</p>
                    <p className="text-xs text-muted-foreground text-center">From gallery</p>
                  </>
                )}
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleCapture}
              className="hidden"
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              onChange={handleCapture}
              className="hidden"
            />

            <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-xs text-green-400 flex items-start gap-2">
              <Image className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p>Photos are securely saved against the selected job site.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
