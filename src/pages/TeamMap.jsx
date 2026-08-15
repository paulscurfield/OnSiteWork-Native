import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { onsiteApi } from '@/api/supabase/adapter';
import { useCompany } from '@/lib/companyContext';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { ChevronLeft, MapPin, Users, Navigation } from 'lucide-react';
import { format, parseISO } from 'date-fns';
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
    throw new Error('Multiple Supabase companies found. A company selector is required before Team Map can load safely.');
  }

  return companyRows[0];
};

const nullableCoordinate = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const defaultIconPrototype = /** @type {L.Icon.Default & { _getIconUrl?: unknown }} */ (L.Icon.Default.prototype);
delete defaultIconPrototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function DirectionsButton({ entry }) {
  const latitude = nullableCoordinate(entry.worker_lat);
  const longitude = nullableCoordinate(entry.worker_lng);
  if (latitude === null || longitude === null) return null;

  return (
    <a
      href={`https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`}
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
  const requestIdRef = useRef(0);
  const [activeEntries, setActiveEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!company) {
      requestIdRef.current += 1;
      setActiveEntries([]);
      setLoading(false);
      return;
    }

    const loadTeamMapEntries = async ({ showLoading = false } = {}) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      if (showLoading) {
        setLoading(true);
        setActiveEntries([]);
      }

      try {
        const [profile, companyRows] = await Promise.all([
          onsiteApi.auth.me(),
          onsiteApi.tables.companies.list('name'),
        ]);
        if (requestId !== requestIdRef.current) return;

        const resolvedCompany = resolveSupabaseCompany(profile, companyRows);
        const entries = await onsiteApi.teamMap.getTeamMapEntries(resolvedCompany.id);
        if (requestId !== requestIdRef.current) return;

        setActiveEntries(entries);
      } catch (error) {
        if (requestId === requestIdRef.current) {
          console.error('Failed to load Supabase Team Map entries:', error);
          setActiveEntries([]);
          toast.error('Failed to load team map');
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    loadTeamMapEntries({ showLoading: true });
    const interval = setInterval(() => loadTeamMapEntries(), 30000);
    return () => {
      requestIdRef.current += 1;
      clearInterval(interval);
    };
  }, [company]);

  const workersWithLocation = activeEntries.filter((entry) => {
    const latitude = nullableCoordinate(entry.worker_lat);
    const longitude = nullableCoordinate(entry.worker_lng);
    return latitude !== null && longitude !== null;
  });
  /** @type {import('leaflet').LatLngExpression} */
  const mapCenter = workersWithLocation.length > 0
    ? [
        /** @type {number} */ (nullableCoordinate(workersWithLocation[0].worker_lat)),
        /** @type {number} */ (nullableCoordinate(workersWithLocation[0].worker_lng)),
      ]
    : [-33.8688, 151.2093];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-6 pt-14 pb-4 flex items-center gap-4">
        <Link to="/" className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-black">Team Map</h1>
          <p className="text-xs text-muted-foreground">{activeEntries.length} live active worker{activeEntries.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Map */}
      <div className="mx-6 rounded-2xl overflow-hidden border border-border flex-1 min-h-[400px]">
        {!loading && (
          <MapContainer center={mapCenter} zoom={13} style={{ height: '100%', width: '100%', minHeight: '400px' }} zoomControl={true}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {workersWithLocation.map(entry => {
              const latitude = /** @type {number} */ (nullableCoordinate(entry.worker_lat));
              const longitude = /** @type {number} */ (nullableCoordinate(entry.worker_lng));
              return (
                <Marker key={entry.id} position={[latitude, longitude]}>
                  <Popup>
                    <div className="text-sm font-semibold">{entry.worker_name}</div>
                    <div className="text-xs text-gray-500">{entry.job_name}</div>
                    <div className="text-xs text-gray-400 mb-2">Since {format(parseISO(entry.start_time), 'h:mm a')}</div>
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 font-semibold underline"
                    >
                      📍 Get Directions
                    </a>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        )}
      </div>

      {/* Worker List */}
      <div className="px-6 py-4 space-y-2">
        {loading ? (
          <div className="text-center py-6 text-muted-foreground text-sm">Loading...</div>
        ) : activeEntries.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-muted-foreground text-sm">No live active workers</p>
          </div>
        ) : activeEntries.map(entry => (
          <div key={entry.id} className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full flex-shrink-0 bg-green-400 animate-pulse" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">{entry.worker_name}</p>
              <p className="text-xs text-muted-foreground">
                {entry.job_name}{entry.job_number ? ` #${entry.job_number}` : ''} · Since {format(parseISO(entry.start_time), 'h:mm a')}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <DirectionsButton entry={entry} />
              <MapPin className="w-4 h-4 text-green-400" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
