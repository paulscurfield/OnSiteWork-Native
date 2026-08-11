import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { onsiteApi } from '@/api/supabase/adapter';
import { useCompany } from '@/lib/companyContext';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import { ChevronLeft, MapPin, Play, Square, Clock, Navigation } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

const resolveSupabaseCompany = (profile, companyRows) => {
  if (!profile?.id) {
    throw new Error('Not authenticated with Supabase');
  }

  if (companyRows.length === 0) {
    throw new Error('No Supabase company found for this user');
  }
  if (companyRows.length > 1) {
    throw new Error('Multiple Supabase companies found. A company selector is required before Clock In can load safely.');
  }

  return companyRows[0];
};

const nullableCoordinate = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

/**
 * @typedef {{
 *   id: string,
 *   job_name?: string | null,
 *   job_number?: string | null,
 *   location_address?: string | null,
 *   latitude?: number | string | null,
 *   longitude?: number | string | null
 * }} ClockJob
 */

function MapRecenter({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.setView(position, 15);
  }, [position]);
  return null;
}

// Fix leaflet default marker
const defaultIconPrototype = /** @type {L.Icon.Default & { _getIconUrl?: unknown }} */ (L.Icon.Default.prototype);
delete defaultIconPrototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export default function ClockIn() {
  const { company } = useCompany();
  const { jobId } = useParams();
  const navigate = useNavigate();
  const requestIdRef = useRef(0);
  const clockContextRef = useRef({ companyId: null, jobId: null });
  const [job, setJob] = useState(null);
  const [user, setUser] = useState(null);
  const [supabaseCompany, setSupabaseCompany] = useState(null);
  const [activeEntry, setActiveEntry] = useState(null);
  const [userPosition, setUserPosition] = useState(null);
  const [jobPosition, setJobPosition] = useState(null);
  const [elapsed, setElapsed] = useState('00:00:00');
  const [loading, setLoading] = useState(false);
  const [lunchBreakMins, setLunchBreakMins] = useState(0);
  const [showLunchPrompt, setShowLunchPrompt] = useState(false);
  const [lunchPromptDismissed, setLunchPromptDismissed] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!company || !jobId) {
      setJob(null);
      setUser(null);
      setSupabaseCompany(null);
      setActiveEntry(null);
      setJobPosition(null);
      setElapsed('00:00:00');
      setLunchBreakMins(0);
      setShowLunchPrompt(false);
      setLunchPromptDismissed(false);
      lunchPromptDismissedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setJob(null);
    setUser(null);
    setSupabaseCompany(null);
    setActiveEntry(null);
    setJobPosition(null);
    setElapsed('00:00:00');
    setLunchBreakMins(0);
    setShowLunchPrompt(false);
    setLunchPromptDismissed(false);
    lunchPromptDismissedRef.current = false;
    if (timerRef.current) clearInterval(timerRef.current);

    const loadClockIn = async () => {
      try {
        const [profile, companyRows] = await Promise.all([
          onsiteApi.auth.me(),
          onsiteApi.tables.companies.list('name'),
        ]);
        if (requestId !== requestIdRef.current) return;

        const resolvedCompany = resolveSupabaseCompany(profile, companyRows);
        const [jobs, activeTimeEntry] = await Promise.all([
          onsiteApi.tables.jobs.filter({ company_id: resolvedCompany.id, id: jobId }),
          onsiteApi.tables.timeEntries.getMyActive(resolvedCompany.id),
        ]);
        if (requestId !== requestIdRef.current) return;

        const j = /** @type {ClockJob | null} */ (/** @type {unknown} */ (jobs[0] || null));
        setUser(profile);
        setSupabaseCompany(resolvedCompany);
        setJob(j);
        if (activeTimeEntry) {
          setActiveEntry(activeTimeEntry);
          setLunchBreakMins(activeTimeEntry.lunch_break_mins ?? 0);
          startTimer(activeTimeEntry.start_time);
        }

        if (j) {
          const latitude = nullableCoordinate(j.latitude);
          const longitude = nullableCoordinate(j.longitude);
          if (latitude !== null && longitude !== null) {
            setJobPosition([latitude, longitude]);
          } else if (j.location_address) {
            // Geocode the address using Nominatim
            fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(j.location_address)}&limit=1`)
              .then(r => r.json())
              .then(results => {
                if (requestId !== requestIdRef.current) return;
                if (results[0]) {
                  setJobPosition([parseFloat(results[0].lat), parseFloat(results[0].lon)]);
                }
              })
              .catch(() => {});
          }
        }
      } catch (error) {
        if (requestId === requestIdRef.current) {
          console.error('Failed to load Supabase clock-in state:', error);
          setJob(null);
          setUser(null);
          setSupabaseCompany(null);
          setActiveEntry(null);
          setJobPosition(null);
          setElapsed('00:00:00');
          setLunchBreakMins(0);
          setShowLunchPrompt(false);
          setLunchPromptDismissed(false);
          lunchPromptDismissedRef.current = false;
          toast.error('Failed to load clock-in state');
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    loadClockIn();
    return () => {
      requestIdRef.current += 1;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [company, jobId]);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(pos => {
      setUserPosition([pos.coords.latitude, pos.coords.longitude]);
    });
  }, []);

  const lunchPromptDismissedRef = useRef(false);

  useEffect(() => {
    clockContextRef.current = {
      companyId: supabaseCompany?.id || null,
      jobId: job?.id || null,
    };
  }, [supabaseCompany?.id, job?.id]);

  const isClockContextCurrent = (requestId, companyId, clockJobId) => (
    requestId === requestIdRef.current &&
    clockContextRef.current.companyId === companyId &&
    clockContextRef.current.jobId === clockJobId
  );

  const startTimer = (startTime) => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const diff = Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setElapsed(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
      // Auto-prompt lunch after 5.5 hours if not already dismissed or taken
      if (diff >= 5.5 * 3600 && !lunchPromptDismissedRef.current) {
        setShowLunchPrompt(true);
      }
    }, 1000);
  };

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const handleStart = async () => {
    if (loading || activeEntry) return;
    if (!user || !job || !supabaseCompany?.id) {
      toast.error('Clock-in is not ready yet');
      return;
    }
    const clockRequestId = requestIdRef.current;
    const clockCompanyId = supabaseCompany.id;
    const clockJobId = job.id;
    setLoading(true);
    try {
      const nowDate = new Date();
      const now = nowDate.toISOString();

      // Get current GPS position to share location while on shift
      let lat = null, lng = null;
      try {
        const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }));
        lat = nullableCoordinate(pos.coords.latitude);
        lng = nullableCoordinate(pos.coords.longitude);
      } catch {}

      if (!isClockContextCurrent(clockRequestId, clockCompanyId, clockJobId)) return;

      const entry = await onsiteApi.tables.timeEntries.clockIn({
        company_id: clockCompanyId,
        job_id: clockJobId,
        date: format(nowDate, 'yyyy-MM-dd'),
        start_time: now,
        worker_lat: lat,
        worker_lng: lng,
      });
      if (!isClockContextCurrent(clockRequestId, clockCompanyId, clockJobId)) return;

      setActiveEntry(entry);
      setLunchBreakMins(entry?.lunch_break_mins ?? 0);
      startTimer(entry?.start_time || now);
      toast.success('Clocked in!');
    } catch (e) {
      console.error('Failed to clock in with Supabase:', e);
      toast.error(e.message || 'Failed to clock in. Please try again.');
      if (isClockContextCurrent(clockRequestId, clockCompanyId, clockJobId)) {
        try {
          const currentActive = await onsiteApi.tables.timeEntries.getMyActive(clockCompanyId);
          if (!isClockContextCurrent(clockRequestId, clockCompanyId, clockJobId)) return;
          setActiveEntry(currentActive);
          if (currentActive?.start_time) startTimer(currentActive.start_time);
        } catch {}
      }
    } finally {
      if (isClockContextCurrent(clockRequestId, clockCompanyId, clockJobId)) {
        setLoading(false);
      }
    }
  };

  const handleLunchBreak = (mins) => {
    setLunchBreakMins(mins);
    setShowLunchPrompt(false);
    setLunchPromptDismissed(true);
    lunchPromptDismissedRef.current = true;
  };

  const handleFinish = async () => {
    if (!activeEntry || loading) return;
    setLoading(true);
    try {
      const completedEntry = await onsiteApi.tables.timeEntries.clockOut(activeEntry.id, {
        finish_time: new Date().toISOString(),
        lunch_break_mins: Number.isFinite(Number(lunchBreakMins)) ? Number(lunchBreakMins) : 0,
      });

      if (timerRef.current) clearInterval(timerRef.current);
      setActiveEntry(null);
      setElapsed('00:00:00');
      const hours = Number(completedEntry?.total_hours ?? 0);
      toast.success(`Clocked out! ${hours.toFixed(2)} hrs logged.`);
      navigate('/timesheets');
    } catch (error) {
      console.error('Failed to clock out with Supabase:', error);
      toast.error(error.message || 'Failed to clock out. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const mapCenter = jobPosition || userPosition || [-33.8688, 151.2093];
  const routeJobId = job?.id || null;
  const activeJobId = activeEntry?.job_id || null;
  const activeJobLabel = activeEntry?.job_name || 'another job';
  const activeJobNumber = activeEntry?.job_number ? `#${activeEntry.job_number}` : '';
  const activeJobDiffersFromRoute = Boolean(activeEntry && routeJobId && activeJobId !== routeJobId);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-6 pt-14 pb-4 flex items-center gap-4">
        <Link to="/jobs" className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-black">{job?.job_name || 'Loading...'}</h1>
          {job?.job_number && <p className="text-xs text-muted-foreground font-mono">#{job.job_number}</p>}
        </div>
      </div>

      {/* Map */}
      <div className="mx-6 rounded-2xl overflow-hidden border border-border h-52 flex-shrink-0">
        {mapCenter && (
          <MapContainer center={mapCenter} zoom={14} style={{ height: '100%', width: '100%' }} zoomControl={false}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <MapRecenter position={jobPosition || userPosition} />
            {userPosition && (
              <Marker position={userPosition}>
                <Popup>Your Location</Popup>
              </Marker>
            )}
            {jobPosition && (
              <>
                <Marker position={jobPosition}>
                  <Popup>{job.job_name}{job?.location_address ? `\n${job.location_address}` : ''}</Popup>
                </Marker>
                <Circle
                  center={jobPosition}
                  radius={200}
                  pathOptions={{ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.1 }}
                />
              </>
            )}
          </MapContainer>
        )}
      </div>

      {/* Location Info */}
      {job?.location_address && (
        <div className="mx-6 mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-muted-foreground text-sm flex-1 min-w-0">
            <MapPin className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="truncate">{job.location_address}</span>
          </div>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.location_address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 text-amber-400 text-xs font-semibold flex-shrink-0"
          >
            <Navigation className="w-3.5 h-3.5" />
            Directions
          </a>
        </div>
      )}

      {/* Timer Display */}
      <div className="flex-1 px-6 mt-6 flex flex-col items-center">
        <div className={`w-48 h-48 rounded-full border-4 flex flex-col items-center justify-center mb-6 transition-all duration-500 ${
          activeEntry
            ? 'border-green-400/60 bg-green-500/10 shadow-[0_0_40px_rgba(34,197,94,0.2)]'
            : 'border-border bg-secondary/30'
        }`}>
          <Clock className={`w-6 h-6 mb-2 ${activeEntry ? 'text-green-400' : 'text-muted-foreground'}`} />
          <p className={`font-mono text-2xl font-bold ${activeEntry ? 'text-green-400' : 'text-muted-foreground'}`}>
            {elapsed}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {activeEntry ? 'Time Elapsed' : 'Ready'}
          </p>
        </div>

        {activeEntry && (
          <div className="text-center mb-6">
            <p className="text-muted-foreground text-sm">
              Started: {format(new Date(activeEntry.start_time), 'h:mm a')}
            </p>
            {activeJobDiffersFromRoute && (
              <div className="mt-3 rounded-2xl border border-green-400/30 bg-green-500/10 px-4 py-3">
                <p className="text-green-400 text-sm font-bold">
                  Currently clocked into {activeJobLabel}{activeJobNumber ? ` ${activeJobNumber}` : ''}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  This page is showing {job?.job_name || 'the selected job'} for map and directions.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Lunch Break Auto-prompt */}
        {showLunchPrompt && (
          <div className="w-full mb-4 rounded-2xl border-2 border-amber-500/40 bg-amber-500/10 p-4 text-center">
            <p className="text-amber-400 font-bold text-sm mb-1">🍽️ Lunch Break?</p>
            <p className="text-muted-foreground text-xs mb-3">You've been working over 5.5 hours. Did you take a lunch break?</p>
            <div className="flex gap-2 justify-center flex-wrap">
              {[30, 45, 60].map(mins => (
                <button key={mins} onClick={() => handleLunchBreak(mins)}
                  className="px-3 py-1.5 rounded-xl bg-amber-500/20 text-amber-400 text-xs font-bold border border-amber-500/30">
                  {mins} min
                </button>
              ))}
              <button onClick={() => handleLunchBreak(0)}
                className="px-3 py-1.5 rounded-xl bg-secondary text-muted-foreground text-xs font-bold">
                No break
              </button>
            </div>
          </div>
        )}

        {/* Lunch break indicator / manual button */}
        {activeEntry && !showLunchPrompt && (
          <div className="w-full mb-4">
            {lunchBreakMins > 0 ? (
              <div className="flex items-center justify-between px-4 py-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/30">
                <span className="text-amber-400 text-sm font-semibold">🍽️ {lunchBreakMins} min lunch break recorded</span>
                <button onClick={() => { setLunchBreakMins(0); setLunchPromptDismissed(false); }}
                  className="text-xs text-muted-foreground underline">Clear</button>
              </div>
            ) : (
              <button onClick={() => setShowLunchPrompt(true)}
                className="w-full py-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 font-semibold text-sm">
                🍽️ Add Lunch Break
              </button>
            )}
          </div>
        )}

        {/* Start / Finish Buttons */}
        {!activeEntry ? (
          <button
            onClick={handleStart}
            disabled={loading}
            className="w-full py-5 rounded-2xl bg-primary text-primary-foreground font-black text-xl flex items-center justify-center gap-3 transition-all active:scale-95 disabled:opacity-60 glow-amber animate-pulse-amber"
          >
            <Play className="w-6 h-6 fill-current" />
            START
          </button>
        ) : (
          <button
            onClick={handleFinish}
            disabled={loading}
            className="w-full py-5 rounded-2xl bg-destructive text-destructive-foreground font-black text-xl flex items-center justify-center gap-3 transition-all active:scale-95 disabled:opacity-60"
          >
            <Square className="w-6 h-6 fill-current" />
            FINISH
          </button>
        )}
      </div>
    </div>
  );
}
