import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Square, Loader2, ArrowLeft, Clock, Navigation } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import { toast } from 'sonner';
import { format } from 'date-fns';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix leaflet default marker icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const workerIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const jobIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

export default function ClockScreen() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [userPos, setUserPos] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setCurrentUser);
  }, []);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(
        pos => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => toast.error('Could not get your location. Please enable GPS.'),
        { enableHighAccuracy: true }
      );
    }
  }, []);

  const { data: job, isLoading: jobLoading } = useQuery({
    queryKey: ['job', jobId],
    queryFn: async () => {
      const jobs = await base44.entities.Job.filter({ id: jobId });
      return jobs[0];
    },
  });

  const { data: activeEntries = [], refetch: refetchActive } = useQuery({
    queryKey: ['activeEntry', jobId, currentUser?.email],
    queryFn: () => base44.entities.TimeEntry.filter({ worker_email: currentUser.email, job_id: jobId, status: 'clocked_in' }),
    enabled: !!currentUser?.email,
  });

  const activeEntry = activeEntries[0];

  const handleClockIn = async () => {
    setProcessing(true);
    const now = new Date();
    await base44.entities.TimeEntry.create({
      worker_email: currentUser.email,
      worker_name: currentUser.full_name,
      job_id: jobId,
      job_name: job.job_name,
      job_number: job.job_number,
      date: format(now, 'yyyy-MM-dd'),
      start_time: format(now, 'HH:mm'),
      clock_in_lat: userPos?.lat,
      clock_in_lng: userPos?.lng,
      status: 'clocked_in',
    });
    toast.success('Clocked in successfully!');
    refetchActive();
    queryClient.invalidateQueries({ queryKey: ['activeEntry'] });
    setProcessing(false);
  };

  const handleClockOut = async () => {
    setProcessing(true);
    const now = new Date();
    const finishTime = format(now, 'HH:mm');
    const [startH, startM] = activeEntry.start_time.split(':').map(Number);
    const totalHours = ((now.getHours() * 60 + now.getMinutes()) - (startH * 60 + startM)) / 60;

    await base44.entities.TimeEntry.update(activeEntry.id, {
      finish_time: finishTime,
      total_hours: Math.round(totalHours * 100) / 100,
      status: 'completed',
    });
    toast.success('Clocked out! Total: ' + totalHours.toFixed(1) + ' hours');
    refetchActive();
    queryClient.invalidateQueries({ queryKey: ['activeEntry'] });
    setProcessing(false);
  };

  if (jobLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const mapCenter = job?.location_lat && job?.location_lng 
    ? [job.location_lat, job.location_lng]
    : userPos ? [userPos.lat, userPos.lng] : [-33.8688, 151.2093];

  return (
    <div className="space-y-5 pb-20 lg:pb-0">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/jobs')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{job?.job_name}</h1>
          <p className="text-sm text-muted-foreground">#{job?.job_number}</p>
        </div>
      </div>

      {/* Map */}
      <Card className="overflow-hidden h-[350px] md:h-[400px]">
        <MapContainer center={mapCenter} zoom={14} className="h-full w-full" scrollWheelZoom={false}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
          {userPos && (
            <Marker position={[userPos.lat, userPos.lng]} icon={workerIcon}>
              <Popup>Your Location</Popup>
            </Marker>
          )}
          {job?.location_lat && job?.location_lng && (
            <>
              <Marker position={[job.location_lat, job.location_lng]} icon={jobIcon}>
                <Popup>{job.job_name}</Popup>
              </Marker>
              <Circle center={[job.location_lat, job.location_lng]} radius={200} pathOptions={{ color: '#3b82f6', fillOpacity: 0.1 }} />
            </>
          )}
        </MapContainer>
      </Card>

      {/* Status & Buttons */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {format(new Date(), 'EEEE, d MMMM yyyy')}
            </span>
          </div>
          {activeEntry ? (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Clocked In</Badge>
          ) : (
            <Badge variant="outline">Not Clocked In</Badge>
          )}
        </div>

        {activeEntry && (
          <div className="bg-muted rounded-lg p-3 mb-4 text-sm">
            <p><strong>Started:</strong> {activeEntry.start_time}</p>
            <p className="text-muted-foreground mt-1">Time is being tracked...</p>
          </div>
        )}

        <div className="flex gap-3">
          {!activeEntry ? (
            <Button onClick={handleClockIn} disabled={processing} className="flex-1 h-14 text-lg bg-emerald-600 hover:bg-emerald-700">
              {processing ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Play className="w-5 h-5 mr-2" />}
              START
            </Button>
          ) : (
            <Button onClick={handleClockOut} disabled={processing} variant="destructive" className="flex-1 h-14 text-lg">
              {processing ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Square className="w-5 h-5 mr-2" />}
              FINISH
            </Button>
          )}
        </div>

        {userPos && (
          <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
            <Navigation className="w-3 h-3" />
            GPS: {userPos.lat.toFixed(4)}, {userPos.lng.toFixed(4)}
          </p>
        )}
      </Card>
    </div>
  );
}