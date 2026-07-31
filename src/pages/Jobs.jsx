import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { onsiteApi } from '@/api/supabase/adapter';
import { useCompany } from '@/lib/companyContext';
import { Link } from 'react-router-dom';
import { Briefcase, MapPin, ChevronLeft, ChevronRight, Search, Trash2, Pencil, X, Navigation, Plus, Check } from 'lucide-react';
import { toast } from 'sonner';

const statusColors = {
  active: 'bg-green-500/20 text-green-400 border-green-500/30',
  completed: 'bg-muted text-muted-foreground border-border',
  on_hold: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
};

const resolveSupabaseCompany = (profile, companyRows) => {
  if (!profile?.id) {
    throw new Error('Not authenticated with Supabase');
  }

  if (companyRows.length === 0) {
    throw new Error('No Supabase company found for this user');
  }
  if (companyRows.length > 1) {
    throw new Error('Multiple Supabase companies found. A company selector is required before Jobs can load safely.');
  }

  return companyRows[0];
};

/**
 * @typedef {{
 *   job_name: string,
 *   job_number: string,
 *   location_address: string,
 *   status: string,
 *   notes: string
 * }} JobEditForm
 */

export default function Jobs() {
  const { company } = useCompany();
  const requestIdRef = useRef(0);
  const [supabaseCompany, setSupabaseCompany] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editJob, setEditJob] = useState(null);
  const [editForm, setEditForm] = useState(/** @type {JobEditForm} */ ({}));
  const [editSaving, setEditSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ job_name: '', job_number: '', location_address: '', notes: '' });
  const [addSaving, setAddSaving] = useState(false);
  const [deleteSavingId, setDeleteSavingId] = useState(null);

  useEffect(() => {
    if (!company) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setSupabaseCompany(null);

    const loadJobs = async () => {
      try {
        const [profile, companyRows] = await Promise.all([
          onsiteApi.auth.me(),
          onsiteApi.tables.companies.list('name'),
        ]);
        if (requestId !== requestIdRef.current) return;

        const resolvedSupabaseCompany = resolveSupabaseCompany(profile, companyRows);
        const data = await onsiteApi.tables.jobs.filter(
          { company_id: resolvedSupabaseCompany.id },
          '-created_date'
        );
        if (requestId !== requestIdRef.current) return;

        setSupabaseCompany(resolvedSupabaseCompany);
        setJobs(data);
      } catch (error) {
        if (requestId === requestIdRef.current) {
          console.error('Failed to load Supabase jobs:', error);
          setSupabaseCompany(null);
          setJobs([]);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    loadJobs();
    return () => {
      requestIdRef.current += 1;
    };
  }, [company]);

  const handleDelete = async (e, jobId) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteSavingId(jobId);
    try {
      await onsiteApi.tables.jobs.delete(jobId);
      setJobs(currentJobs => currentJobs.filter(j => j.id !== jobId));
      toast.success('Job deleted');
    } catch (error) {
      console.error('Failed to delete Supabase job:', error);
      toast.error('Failed to delete job');
    } finally {
      setDeleteSavingId(null);
    }
  };

  const openEdit = (e, job) => {
    e.preventDefault();
    e.stopPropagation();
    setEditJob(job);
    setEditForm({
      job_name: job.job_name || '',
      job_number: job.job_number || '',
      location_address: job.location_address || '',
      status: job.status || 'active',
      notes: job.notes || '',
    });
  };

  const handleEditSave = async () => {
    setEditSaving(true);
    try {
      const updatedJob = await onsiteApi.tables.jobs.update(editJob.id, {
        job_name: editForm.job_name,
        job_number: editForm.job_number,
        location_address: editForm.location_address,
        status: editForm.status,
        notes: editForm.notes,
      });
      setJobs(currentJobs =>
        currentJobs.map(j => j.id === editJob.id ? updatedJob : j)
      );
      toast.success('Job updated');
      setEditJob(null);
    } catch (error) {
      console.error('Failed to update Supabase job:', error);
      toast.error('Failed to update job');
    } finally {
      setEditSaving(false);
    }
  };

  const handleAddJob = async () => {
    if (!addForm.job_name || !addForm.job_number) { toast.error('Job name and number are required'); return; }
    if (!supabaseCompany?.id) { toast.error('Supabase company is not ready yet'); return; }
    setAddSaving(true);
    try {
      const newJob = await onsiteApi.tables.jobs.create({
        company_id: supabaseCompany.id,
        job_name: addForm.job_name,
        job_number: addForm.job_number,
        location_address: addForm.location_address,
        latitude: null,
        longitude: null,
        notes: addForm.notes,
        status: 'active',
      });
      setJobs(currentJobs => [newJob, ...currentJobs]);
      toast.success('Job added!');
      setShowAddModal(false);
      setAddForm({ job_name: '', job_number: '', location_address: '', notes: '' });
    } catch (error) {
      console.error('Failed to create Supabase job:', error);
      toast.error('Failed to add job');
    } finally {
      setAddSaving(false);
    }
  };

  const filtered = jobs.filter(j =>
    j.job_name?.toLowerCase().includes(search.toLowerCase()) ||
    j.job_number?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="px-6 pt-14 pb-4 flex items-center gap-4">
        <Link to="/" className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-black flex-1">Job Sites</h1>
        <button onClick={() => setShowAddModal(true)}
          className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
          <Plus className="w-5 h-5 text-primary-foreground" />
        </button>
      </div>

      {/* Search */}
      <div className="px-6 mb-4">
        <div className="flex items-center gap-3 bg-card border border-border rounded-2xl px-4 py-3">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search jobs..."
            className="bg-transparent flex-1 outline-none text-sm placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Add Job Modal */}
      {showAddModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end justify-center" onClick={() => setShowAddModal(false)}>
          <div className="bg-card border border-border rounded-t-3xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-lg font-black">Add Job Site</h2>
                <p className="text-xs text-muted-foreground">Admin will be notified of the new job</p>
              </div>
              <button onClick={() => setShowAddModal(false)} className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Job Name *</label>
                <input value={addForm.job_name} onChange={e => setAddForm({ ...addForm, job_name: e.target.value })}
                  placeholder="e.g. Smith Residence"
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Job Number *</label>
                <input value={addForm.job_number} onChange={e => setAddForm({ ...addForm, job_number: e.target.value })}
                  placeholder="e.g. JOB-001"
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Address (optional)</label>
                <input value={addForm.location_address} onChange={e => setAddForm({ ...addForm, location_address: e.target.value })}
                  placeholder="123 Main St"
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notes (optional)</label>
                <input value={addForm.notes} onChange={e => setAddForm({ ...addForm, notes: e.target.value })}
                  placeholder="Any details for the admin..."
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
              </div>
            </div>
            <button onClick={handleAddJob} disabled={addSaving}
              className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-60 transition-all active:scale-95 flex items-center justify-center gap-2">
              <Check className="w-4 h-4" />
              {addSaving ? 'Adding...' : 'Add Job Site'}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Edit Modal */}
      {editJob && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end justify-center" onClick={() => setEditJob(null)}>
          <div className="bg-card border border-border rounded-t-3xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-black">Edit Job Site</h2>
              <button onClick={() => setEditJob(null)} className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Job Name</label>
                <input value={editForm.job_name} onChange={e => setEditForm({ ...editForm, job_name: e.target.value })}
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Job Number</label>
                <input value={editForm.job_number} onChange={e => setEditForm({ ...editForm, job_number: e.target.value })}
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Address</label>
                <input value={editForm.location_address} onChange={e => setEditForm({ ...editForm, location_address: e.target.value })}
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</label>
                <select value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary">
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="on_hold">On Hold</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notes</label>
                <textarea value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                  rows={2} className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary resize-none" />
              </div>
            </div>
            <button onClick={handleEditSave} disabled={editSaving}
              className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-60 transition-all active:scale-95">
              {editSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Job List */}
      <div className="px-6 space-y-3">
        {loading ? (
          Array(4).fill(0).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-card border border-border animate-pulse" />
          ))
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Briefcase className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">No job sites found</p>
            <p className="text-muted-foreground/60 text-sm mt-1">Admin can add jobs from the Admin panel</p>
          </div>
        ) : (
          filtered.map(job => (
            <div key={job.id} className="bg-card border border-border rounded-2xl p-4">
              {/* Top row: icon + name/number + action buttons */}
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <Briefcase className="w-5 h-5 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-base">{job.job_name}</p>
                  <p className="text-xs text-muted-foreground font-mono">#{job.job_number}</p>
                  {job.location_address && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3 text-muted-foreground/60 flex-shrink-0" />
                      <p className="text-xs text-muted-foreground/60 truncate">{job.location_address}</p>
                    </div>
                  )}
                </div>
                <span className={`flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase ${statusColors[job.status] || statusColors.active}`}>
                  {job.status}
                </span>
              </div>
              {/* Bottom row: Directions + admin buttons + clock in */}
              <div className="flex items-center gap-2 mt-3">
                {(job.latitude && job.longitude) || job.location_address ? (
                  <a
                    href={
                      job.latitude && job.longitude
                        ? `https://www.google.com/maps/dir/?api=1&destination=${job.latitude},${job.longitude}`
                        : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.location_address)}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-semibold"
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    Directions
                  </a>
                ) : null}
                <div className="flex-1" />
                <button onClick={(e) => openEdit(e, job)}
                  className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center hover:bg-primary/20 transition-colors">
                  <Pencil className="w-4 h-4 text-muted-foreground" />
                </button>
                <button onClick={(e) => handleDelete(e, job.id)} disabled={deleteSavingId === job.id}
                  className="w-8 h-8 rounded-xl bg-destructive/10 flex items-center justify-center hover:bg-destructive/20 transition-colors">
                  <Trash2 className="w-4 h-4 text-destructive" />
                </button>
                <Link to={`/clockin/${job.id}`}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold">
                  <ChevronRight className="w-4 h-4" />
                  Clock In
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
