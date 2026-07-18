import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { onsiteApi } from '@/api/supabase/adapter';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  Loader2,
  Plus,
  RefreshCcw,
  UserCheck,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

const JOB_COLORS = [
  '#10B981',
  '#3B82F6',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#84CC16',
];

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMPTY_RANGE = { start_date: '', end_date: '' };

const emptyForm = {
  title: '',
  job_id: '',
  start_date: '',
  end_date: '',
  color: '#10B981',
  notes: '',
  assigned_user_ids: [],
};

const isLeapYear = (year) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const dateParts = (dateOnly) => {
  if (!DATE_ONLY_PATTERN.test(dateOnly || '')) return null;
  const [year, month, day] = dateOnly.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12) return null;
  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  if (day < 1 || day > maxDay) return null;
  return { year, month, day };
};

const requireDateOnly = (value, label) => {
  if (!dateParts(value)) throw new Error(`${label} must be a valid YYYY-MM-DD date`);
  return value;
};

const formatDate = (dateOnly) => {
  const parts = dateParts(dateOnly);
  if (!parts) return dateOnly || '';
  return `${parts.day} ${MONTH_NAMES[parts.month - 1]} ${parts.year}`;
};

const formatRange = (startDate, endDate) => {
  if (startDate === endDate) return formatDate(startDate);
  return `${formatDate(startDate)} to ${formatDate(endDate)}`;
};

const sortByDate = (a, b) => {
  const start = (a.start_date || '').localeCompare(b.start_date || '');
  if (start !== 0) return start;
  return (a.title || '').localeCompare(b.title || '');
};

const isLeaveSchedule = (schedule) => schedule?.source_type === 'leave';

const resolveSupabaseCompany = (profile, companyRows) => {
  if (!profile?.id) {
    throw new Error('Not authenticated with Supabase');
  }

  if (companyRows.length === 0) {
    throw new Error('No Supabase company found for this user');
  }
  if (companyRows.length > 1) {
    throw new Error('Multiple Supabase companies found. A company selector is required before Calendar can load safely.');
  }

  return companyRows[0];
};

export default function Calendar() {
  const requestIdRef = useRef(0);
  const [supabaseCompany, setSupabaseCompany] = useState(null);
  const [currentMember, setCurrentMember] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [range, setRange] = useState(EMPTY_RANGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [assignmentsTouched, setAssignmentsTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isAdmin = currentMember?.role === 'owner' || currentMember?.role === 'admin';

  const groupedSchedules = useMemo(() => {
    return schedules.reduce((groups, schedule) => {
      const key = schedule.start_date || 'Unscheduled';
      if (!groups[key]) groups[key] = [];
      groups[key].push(schedule);
      return groups;
    }, {});
  }, [schedules]);

  const workerById = useMemo(() => {
    return workers.reduce((directory, worker) => {
      directory[worker.user_id] = worker;
      return directory;
    }, {});
  }, [workers]);

  const loadCalendar = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError('');

    try {
      const [profile, companyRows] = await Promise.all([
        onsiteApi.auth.me(),
        onsiteApi.tables.companies.list('name'),
      ]);
      if (requestId !== requestIdRef.current) return;

      const resolvedCompany = resolveSupabaseCompany(profile, companyRows);
      let scheduleRows = [];
      const hasCompleteRange = range.start_date && range.end_date;

      const [jobRows, workerRows] = await Promise.all([
        onsiteApi.tables.jobs.filter({ company_id: resolvedCompany.id }, 'job_name'),
        onsiteApi.tables.companyMembers.directory(resolvedCompany.id),
      ]);
      if (requestId !== requestIdRef.current) return;

      const resolvedMember = workerRows.find((worker) => worker.user_id === profile.id);
      if (!resolvedMember) {
        throw new Error('Supabase company membership is not available in the worker directory');
      }

      setSupabaseCompany(resolvedCompany);
      setCurrentMember(resolvedMember);
      setJobs(jobRows);
      setWorkers(workerRows);

      if (hasCompleteRange) {
        const startDate = requireDateOnly(range.start_date, 'Start date');
        const endDate = requireDateOnly(range.end_date, 'End date');
        if (endDate < startDate) throw new Error('End date cannot be before start date');

        scheduleRows = await onsiteApi.tables.jobSchedules.forDateRange({
          company_id: resolvedCompany.id,
          start_date: startDate,
          end_date: endDate,
        });
      } else {
        setSchedules([]);
      }
      if (requestId !== requestIdRef.current) return;

      if (hasCompleteRange) {
        setSchedules([...scheduleRows].sort(sortByDate));
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setSchedules([]);
        setError(err.message || 'Unable to load calendar');
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [range.end_date, range.start_date]);

  useEffect(() => {
    loadCalendar();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadCalendar]);

  const selectedJob = jobs.find((job) => job.id === form.job_id);

  const openAdd = () => {
    if (!isAdmin) return;
    setEditingSchedule(null);
    setConfirmDelete(false);
    setAssignmentsTouched(false);
    setForm({ ...emptyForm, start_date: range.start_date || '', end_date: range.start_date || '' });
    setShowModal(true);
  };

  const openEdit = (schedule) => {
    if (!isAdmin) return;
    if (isLeaveSchedule(schedule)) return;
    setEditingSchedule(schedule);
    setConfirmDelete(false);
    setAssignmentsTouched(false);
    setForm({
      title: schedule.title || '',
      job_id: schedule.job_id || '',
      start_date: schedule.start_date || '',
      end_date: schedule.end_date || '',
      color: schedule.color || '#10B981',
      notes: schedule.notes || '',
      assigned_user_ids: schedule.assigned_user_ids || [],
    });
    setShowModal(true);
  };

  const toggleWorker = (userId) => {
    setAssignmentsTouched(true);
    setForm((current) => {
      const isSelected = current.assigned_user_ids.includes(userId);
      return {
        ...current,
        assigned_user_ids: isSelected
          ? current.assigned_user_ids.filter((id) => id !== userId)
          : [...current.assigned_user_ids, userId],
      };
    });
  };

  const validateForm = () => {
    const title = form.title.trim() || selectedJob?.job_name || '';
    if (!supabaseCompany?.id) throw new Error('Supabase company is not loaded yet');
    if (!title) throw new Error('Title is required');
    const startDate = requireDateOnly(form.start_date, 'Start date');
    const endDate = requireDateOnly(form.end_date, 'End date');
    if (endDate < startDate) throw new Error('End date cannot be before start date');

    const workerIds = new Set(workers.map((worker) => worker.user_id));
    const invalidWorker = form.assigned_user_ids.find((userId) => !workerIds.has(userId));
    if (invalidWorker) throw new Error('Assigned workers must be selected from the company worker directory');

    return { title, startDate, endDate };
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError('');

    try {
      if (isLeaveSchedule(editingSchedule)) {
        throw new Error('Leave schedules are managed by the Leave workflow');
      }

      const { title, startDate, endDate } = validateForm();
      const sourceType = form.job_id ? 'job' : editingSchedule?.source_type === 'leave' ? 'leave' : 'manual';
      const payload = {
        company_id: supabaseCompany.id,
        title,
        start_date: startDate,
        end_date: endDate,
        job_id: form.job_id || null,
        job_name: selectedJob?.job_name || title,
        job_number: selectedJob?.job_number || null,
        color: form.color,
        notes: form.notes.trim() || null,
        source_type: sourceType,
      };
      if (!editingSchedule || assignmentsTouched) {
        payload.assigned_user_ids = form.assigned_user_ids;
      }

      if (editingSchedule) {
        await onsiteApi.tables.jobSchedules.update(editingSchedule.id, payload);
        toast.success('Schedule updated');
      } else {
        await onsiteApi.tables.jobSchedules.create(payload);
        toast.success('Schedule added');
      }

      setShowModal(false);
      setEditingSchedule(null);
      setAssignmentsTouched(false);
      setForm(emptyForm);
      await loadCalendar();
    } catch (err) {
      const message = err.message || 'Unable to save schedule';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingSchedule || saving) return;
    setSaving(true);
    setError('');

    try {
      if (isLeaveSchedule(editingSchedule)) {
        throw new Error('Leave schedules are managed by the Leave workflow');
      }

      await onsiteApi.tables.jobSchedules.delete(editingSchedule.id);
      toast.success('Schedule deleted');
      setShowModal(false);
      setEditingSchedule(null);
      setAssignmentsTouched(false);
      setConfirmDelete(false);
      await loadCalendar();
    } catch (err) {
      const message = err.message || 'Unable to delete schedule';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const renderSchedule = (schedule) => {
    const scheduleIsLeave = isLeaveSchedule(schedule);
    const content = (
      <div className="flex items-start gap-3">
        <div className="w-1.5 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: schedule.color || '#10B981' }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-black text-sm truncate">{schedule.title || schedule.job_name}</p>
              {schedule.job_number && <p className="text-xs text-muted-foreground font-mono">#{schedule.job_number}</p>}
            </div>
            <span className="text-[10px] px-2 py-1 rounded-full bg-secondary text-muted-foreground font-bold uppercase">
              {scheduleIsLeave ? 'Managed by Leave' : schedule.source_type || 'manual'}
            </span>
          </div>
          <p className="text-xs text-primary font-semibold mt-1">
            {formatRange(schedule.start_date, schedule.end_date)}
          </p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
            <UserRound className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">
              {schedule.assigned_user_ids?.length
                ? schedule.assigned_user_ids
                  .map((userId) => workerById[userId]?.display_name)
                  .filter(Boolean)
                  .slice(0, 3)
                  .join(', ') || `${schedule.assigned_user_ids.length} worker${schedule.assigned_user_ids.length === 1 ? '' : 's'} assigned`
                : 'No workers assigned'}
              {schedule.assigned_user_ids?.length > 3 && ` +${schedule.assigned_user_ids.length - 3}`}
            </span>
          </div>
          {schedule.notes && <p className="text-xs text-muted-foreground/80 mt-2">{schedule.notes}</p>}
        </div>
      </div>
    );

    if (!isAdmin || scheduleIsLeave) {
      return (
        <div key={schedule.id} className="w-full bg-card border border-border rounded-2xl p-4 text-left">
          {content}
        </div>
      );
    }

    return (
      <button
        key={schedule.id}
        type="button"
        onClick={() => openEdit(schedule)}
        aria-label={`Edit schedule ${schedule.title || schedule.job_name || schedule.id}`}
        className="w-full bg-card border border-border rounded-2xl p-4 text-left active:scale-[0.99] transition-all"
      >
        {content}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="px-6 pt-14 pb-4 flex items-center gap-4">
        <Link to="/" aria-label="Back" className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-black">Job Calendar</h1>
          <p className="text-xs text-muted-foreground">Scheduled work by date</p>
          {supabaseCompany && <p className="text-[10px] text-muted-foreground/70 truncate">{supabaseCompany.name}</p>}
        </div>
        <button
          type="button"
          onClick={loadCalendar}
          disabled={loading}
          aria-label="Refresh calendar"
          className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center disabled:opacity-60"
        >
          <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={openAdd}
            aria-label="Add schedule"
            className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center"
          >
            <Plus className="w-5 h-5 text-primary-foreground" />
          </button>
        )}
      </div>

      <div className="px-6 mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">From</label>
          <input
            type="date"
            value={range.start_date}
            onChange={(event) => setRange((current) => ({ ...current, start_date: event.target.value }))}
            className="mt-1 w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">To</label>
          <input
            type="date"
            value={range.end_date}
            onChange={(event) => setRange((current) => ({ ...current, end_date: event.target.value }))}
            className="mt-1 w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {error && (
        <div className="mx-6 mb-4 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="px-6 space-y-4">
        {loading ? (
          Array(4).fill(0).map((_, index) => (
            <div key={index} className="h-24 rounded-2xl bg-card border border-border animate-pulse" />
          ))
        ) : schedules.length === 0 ? (
          <div className="text-center py-16">
            <CalendarIcon className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">
              {range.start_date && range.end_date ? 'No schedules in this date range' : 'Select a date range'}
            </p>
            {isAdmin && <p className="text-muted-foreground/60 text-sm mt-1">Admins can add schedules after choosing dates</p>}
          </div>
        ) : (
          Object.keys(groupedSchedules).sort().map((dateKey) => (
            <section key={dateKey} className="space-y-2">
              <h2 className="text-xs font-black text-muted-foreground uppercase tracking-wider">
                {formatDate(dateKey)}
              </h2>
              {groupedSchedules[dateKey].map(renderSchedule)}
            </section>
          ))
        )}
      </div>

      {showModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end justify-center" onClick={() => !saving && setShowModal(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-schedule-dialog-title"
            className="bg-card border border-border rounded-t-3xl w-full max-w-lg p-6 space-y-4 max-h-[92vh] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 id="calendar-schedule-dialog-title" className="text-lg font-black">{editingSchedule ? 'Edit Schedule' : 'Add Schedule'}</h2>
                <p className="text-xs text-muted-foreground">Dates stay as calendar-only values</p>
              </div>
              <button
                type="button"
                onClick={() => !saving && setShowModal(false)}
                aria-label="Close modal"
                className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Job Site</label>
                <select
                  value={form.job_id}
                  onChange={(event) => {
                    const job = jobs.find((item) => item.id === event.target.value);
                    setForm((current) => ({
                      ...current,
                      job_id: event.target.value,
                      title: current.title || job?.job_name || '',
                    }));
                  }}
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">No linked job</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.job_name} #{job.job_number}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Title *</label>
                <input
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="e.g. Excavation week"
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Start Date *</label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(event) => setForm((current) => ({ ...current, start_date: event.target.value }))}
                    className="mt-1 w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">End Date *</label>
                  <input
                    type="date"
                    value={form.end_date}
                    onChange={(event) => setForm((current) => ({ ...current, end_date: event.target.value }))}
                    className="mt-1 w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Assigned Workers</label>
                <div className="mt-2 space-y-2">
                  {workers.length === 0 ? (
                    <div className="rounded-2xl border border-border bg-secondary/40 p-3">
                      <p className="text-sm font-semibold text-foreground">No company workers available</p>
                      <p className="text-xs text-muted-foreground mt-1">Schedules can still be saved without assignments.</p>
                    </div>
                  ) : (
                    workers.map((worker) => {
                      const isSelected = form.assigned_user_ids.includes(worker.user_id);
                      return (
                        <button
                          key={worker.user_id}
                          type="button"
                          onClick={() => toggleWorker(worker.user_id)}
                          aria-pressed={isSelected}
                          className={`w-full min-h-[52px] rounded-2xl border px-3 py-2 text-left flex items-center gap-3 transition-all ${
                            isSelected
                              ? 'border-primary bg-primary/10 text-foreground'
                              : 'border-border bg-secondary/40 text-foreground'
                          }`}
                        >
                          <span className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                            isSelected ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground'
                          }`}>
                            <UserCheck className="w-4 h-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-bold truncate">{worker.display_name}</span>
                            {(worker.email || worker.role) && (
                              <span className="block text-xs text-muted-foreground truncate">
                                {[worker.email, worker.role].filter(Boolean).join(' • ')}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Colour</label>
                <div className="mt-2 flex gap-2 flex-wrap">
                  {JOB_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, color }))}
                      aria-label={`Choose colour ${color}`}
                      aria-pressed={form.color === color}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${form.color === color ? 'border-white scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  rows={3}
                  placeholder="Any details for the team"
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary resize-none"
                />
              </div>
            </div>

            {editingSchedule && confirmDelete && (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3">
                <p className="text-sm font-semibold text-destructive">Delete this schedule?</p>
                <p className="text-xs text-muted-foreground mt-1">Assigned workers will be removed through the schedule cascade.</p>
              </div>
            )}

            <div className="flex gap-3 pt-1">
              {editingSchedule && (
                confirmDelete ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={saving}
                    aria-label="Confirm delete schedule"
                    className="px-4 py-3 rounded-2xl bg-destructive text-destructive-foreground font-bold text-sm disabled:opacity-60"
                  >
                    {saving ? 'Deleting...' : 'Confirm'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    disabled={saving}
                    aria-label="Delete schedule"
                    className="px-4 py-3 rounded-2xl bg-destructive/15 border border-destructive/30 text-destructive font-bold text-sm disabled:opacity-60"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? 'Saving...' : editingSchedule ? 'Save Changes' : 'Add Schedule'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
