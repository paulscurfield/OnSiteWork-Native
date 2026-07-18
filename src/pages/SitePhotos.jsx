import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/companyContext';
import { Link } from 'react-router-dom';
import { ChevronLeft, Camera, Loader2, Image } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function SitePhotos() {
  const { company } = useCompany();
  const [user, setUser] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState('');
  const [uploading, setUploading] = useState(false);
  const [notes, setNotes] = useState('');
  const [showPreview, setShowPreview] = useState(null);
  const fileInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
    if (company) base44.entities.Job.filter({ company_id: company.id, status: 'active' }).then(setJobs).catch(() => {});
  }, [company]);

  const handleCapture = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });

    // Auto-select job if worker has an active entry
    let jobId = selectedJob;
    let jobName = '';
    let jobNumber = '';
    if (!jobId) {
      const activeEntries = await base44.entities.TimeEntry.filter({ company_id: company?.id, worker_email: user.email, status: 'active' });
      if (activeEntries[0]) {
        jobId = activeEntries[0].job_id;
        jobName = activeEntries[0].job_name;
        jobNumber = activeEntries[0].job_number;
      }
    } else {
      const job = jobs.find(j => j.id === jobId);
      jobName = job?.job_name || '';
      jobNumber = job?.job_number || '';
    }

    await base44.entities.JobPhoto.create({
      company_id: company?.id,
      worker_email: user.email,
      worker_name: user.full_name,
      job_id: jobId,
      job_name: jobName,
      job_number: jobNumber,
      photo_url: file_url,
      date: format(new Date(), 'yyyy-MM-dd'),
      notes,
    });

    setUploading(false);
    setNotes('');
    toast.success('Photo uploaded to admin panel!');
    e.target.value = '';
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="px-6 pt-14 pb-4 flex items-center gap-4">
        <Link to="/" className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-black flex-1">Site Photos</h1>
      </div>

      <div className="px-6 space-y-4">
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <p className="text-sm font-semibold text-muted-foreground">Select Job Site (optional — auto-detects if clocked in)</p>
          <select
            value={selectedJob}
            onChange={e => setSelectedJob(e.target.value)}
            className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Auto-detect from clock-in</option>
            {jobs.map(j => (
              <option key={j.id} value={j.id}>{j.job_name} #{j.job_number}</option>
            ))}
          </select>
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Add a note (optional)..."
            className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
          />
        </div>

        {/* Camera + Gallery Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
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
            disabled={uploading}
            className="py-6 rounded-2xl border-2 border-dashed border-accent/40 bg-accent/5 flex flex-col items-center gap-3 transition-all active:scale-95 disabled:opacity-60"
          >
            <Image className="w-8 h-8 text-accent" />
            <p className="font-black text-accent">Choose Photo</p>
            <p className="text-xs text-muted-foreground text-center">From gallery</p>
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
          <p>Photos are instantly visible to your admin in the Admin Panel → Photos tab.</p>
        </div>
      </div>
    </div>
  );
}