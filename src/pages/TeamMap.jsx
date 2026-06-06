import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/companyContext';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { ChevronLeft, MapPin, Users, Navigation } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function DirectionsButton({ entry, jobs }) {
  // Prefer worker GPS, then job GPS coords, then job address, then job name as search
  let destination = null;
  if (entry.worker_lat && entry.worker_lng) {
    destination = `${entry.worker_lat},${entry.worker_lng}`;
  } else {
    const job = jobs.find(j => j.id === entry.job_id);
    if (job?.latitude && job?.longitude) {
      destination = `${job.latitude},${job.longitude}`;
    } else if (job?.location_address) {
      destination = encodeURIComponent(job.location_address);
    } else if (entry.job_name) {
      destination = encodeURIComponent(entry.job_name);
    }
  }

  if (!destination) return null;
  return (
    <a
      href={`https://www.google.com/maps/dir/?api=1&destination=${destination}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 text-amber-400 text-xs font-semibold border border-amber-500/30"
    >
      <Navigation className="w-3.5 h-3.5" />
      Directions
    </a>
  );
}

export default function TeamMap() {
  const { company } = useCompany();
  const [todayEntries, setTodayEntries] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!company) return;
    base44.entities.Job.filter({ company_id: company.id }).then(setJobs);
    loadTodayWorkers();
    const interval = setInterval(loadTodayWorkers, 30000);
    return () => clearInterval(interval);
  }, [company]);

  const loadTodayWorkers = async () => {
    if (!company) return;
    const today = format(new Date(), 'yyyy-MM-dd');
    const entries = await base44.entities.TimeEntry.filter({ company_id: company.id, date: today });
    setTodayEntries(entries);
    setLoading(false);
  };

  // Workers currently clocked in with GPS for map markers
  const workersWithLocation = todayEntries.filter(e => e.status === 'active' && e.worker_lat && e.worker_lng);
  const mapCenter = workersWithLocation.length > 0
    ? [workersWithLocation[0].worker_lat, workersWithLocation[0].worker_lng]
    : [-33.8688, 151.2093];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-6 pt-14 pb-4 flex items-center gap-4">
        <Link to="/" className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-black">Team Map</h1>
          <p className="text-xs text-muted-foreground">{todayEntries.length} worker{todayEntries.length !== 1 ? 's' : ''} logged in today</p>
        </div>
      </div>

      {/* Map */}
      <div className="mx-6 rounded-2xl overflow-hidden border border-border flex-1 min-h-[400px]">
        {!loading && (
          <MapContainer center={mapCenter} zoom={13} style={{ height: '100%', width: '100%', minHeight: '400px' }} zoomControl={true}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {workersWithLocation.map(entry => (
              <Marker key={entry.id} position={[entry.worker_lat, entry.worker_lng]}>
                <Popup>
                  <div className="text-sm font-semibold">{entry.worker_name}</div>
                  <div className="text-xs text-gray-500">{entry.job_name}</div>
                  <div className="text-xs text-gray-400 mb-2">Since {format(parseISO(entry.start_time), 'h:mm a')}</div>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${entry.worker_lat},${entry.worker_lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 font-semibold underline"
                  >
                    📍 Get Directions
                  </a>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        )}
      </div>

      {/* Worker List */}
      <div className="px-6 py-4 space-y-2">
        {loading ? (
          <div className="text-center py-6 text-muted-foreground text-sm">Loading...</div>
        ) : todayEntries.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-muted-foreground text-sm">No workers have logged in today</p>
          </div>
        ) : todayEntries.map(entry => (
          <div key={entry.id} className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${entry.status === 'active' ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground/40'}`} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">{entry.worker_name}</p>
              <p className="text-xs text-muted-foreground">
                {entry.job_name} · {entry.status === 'active' ? `Since ${format(parseISO(entry.start_time), 'h:mm a')}` : `${format(parseISO(entry.start_time), 'h:mm a')} – ${entry.finish_time ? format(parseISO(entry.finish_time), 'h:mm a') : '?'} (${(entry.total_hours || 0).toFixed(2)}h)`}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <DirectionsButton entry={entry} jobs={jobs} />
              {entry.status === 'active' ? (
                <MapPin className="w-4 h-4 text-green-400" />
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold">Done</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}