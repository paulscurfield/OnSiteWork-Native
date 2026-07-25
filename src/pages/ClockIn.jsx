import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/companyContext';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import { ChevronLeft, MapPin, Play, Square, Clock, Navigation } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

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
  const [job, setJob] = useState(null);
  const [user, setUser] = useState(null);
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
    Promise.all([
      base44.entities.Job.filter({ id: jobId }),
      base44.auth.me(),
      base44.entities.TimeEntry.filter({ company_id: company?.id, job_id: jobId, status: 'active' }),
    ]).then(([jobs, u, entries]) => {
      const j = jobs[0];
      if (j) {
        setJob(j);
        // If GPS coords stored, use them directly
        if (j.latitude && j.longitude) {
          setJobPosition([j.latitude, j.longitude]);
        } else if (j.location_address) {
          // Geocode the address using Nominatim
          fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(j.location_address)}&limit=1`)
            .then(r => r.json())
            .then(results => {
              if (results[0]) {
                setJobPosition([parseFloat(results[0].lat), parseFloat(results[0].lon)]);
              }
            })
            .catch(() => {});
        }
      }
      setUser(u);
      if (entries[0]) {
        setActiveEntry(entries[0]);
        startTimer(entries[0].start_time);
      }
    }).catch(() => {});

    navigator.geolocation?.getCurrentPosition(pos => {
      setUserPosition([pos.coords.latitude, pos.coords.longitude]);
    });
  }, [jobId]);

  const lunchPromptDismissedRef = useRef(false);

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
    if (!user || !job) return;
    setLoading(true);
    try {
      const now = new Date().toISOString();

      // Get current GPS position to share location while on shift
      let lat = null, lng = null;
      try {
        const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }));
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch {}

      const entry = await base44.entities.TimeEntry.create({
        company_id: company?.id,
        worker_email: user.email,
        worker_name: user.full_name,
        job_id: job.id,
        job_name: job.job_name,
        job_number: job.job_number,
        date: format(new Date(), 'yyyy-MM-dd'),
        start_time: now,
        status: 'active',
        ...(lat && lng ? { worker_lat: lat, worker_lng: lng } : {}),
      });
      setActiveEntry(entry);
      startTimer(now);
      toast.success('Clocked in!');
    } catch (e) {
      toast.error('Failed to clock in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLunchBreak = (mins) => {
    setLunchBreakMins(mins);
    setShowLunchPrompt(false);
    setLunchPromptDismissed(true);
    lunchPromptDismissedRef.current = true;
  };

  const handleFinish = async () => {
    if (!activeEntry) return;
    setLoading(true);
    const now = new Date().toISOString();
    const startMs = new Date(activeEntry.start_time).getTime();
    const rawHours = (Date.now() - startMs) / 3600000;
    const hours = Math.round((rawHours - lunchBreakMins / 60) * 100) / 100;

    await base44.entities.TimeEntry.update(activeEntry.id, {
      finish_time: now,
      lunch_break_mins: lunchBreakMins,
      total_hours: hours,
      status: 'completed',
      worker_lat: null,
      worker_lng: null,
    });

    if (timerRef.current) clearInterval(timerRef.current);
    setActiveEntry(null);
    setElapsed('00:00:00');
    toast.success(`Clocked out! ${hours.toFixed(2)} hrs logged.`);
    setLoading(false);
    navigate('/timesheets');
  };

  const mapCenter = jobPosition || userPosition || [-33.8688, 151.2093];

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
          <p className="text-muted-foreground text-sm mb-6">
            Started: {format(new Date(activeEntry.start_time), 'h:mm a')}
          </p>
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
