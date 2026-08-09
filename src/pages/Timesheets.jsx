import { useState, useEffect, useRef } from 'react';
import { useCompany } from '@/lib/companyContext';
import { onsiteApi } from '@/api/supabase/adapter';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Clock, Plus, Pencil, Trash2, Download, X, Check, FileText, Loader2 } from 'lucide-react';
import { format, startOfWeek, addDays, isSameDay, parseISO } from 'date-fns';
import { toast } from 'sonner';

const resolveSupabaseCompany = (profile, companyRows) => {
  if (!profile?.id) {
    throw new Error('Not authenticated with Supabase');
  }

  if (companyRows.length === 0) {
    throw new Error('No Supabase company found for this user');
  }
  if (companyRows.length > 1) {
    throw new Error('Multiple Supabase companies found. A company selector is required before Timesheets can load safely.');
  }

  return companyRows[0];
};

const sortEntries = (items = []) => {
  return [...items].sort((a, b) => {
    if (a.date !== b.date) return (a.date || '').localeCompare(b.date || '');
    const ta = a.start_time ? new Date(a.start_time).getTime() : 0;
    const tb = b.start_time ? new Date(b.start_time).getTime() : 0;
    return ta - tb;
  });
};

const isEntryInWeek = (entry, weekStart) => {
  const start = format(weekStart, 'yyyy-MM-dd');
  const end = format(addDays(weekStart, 6), 'yyyy-MM-dd');
  return entry.date >= start && entry.date <= end;
};

const formJobIdFromEntry = (entry) => {
  if (entry.job_id) return entry.job_id;
  if (entry.job_name === 'Sick Day') return 'sick_day';
  if (entry.job_name === 'Annual Leave') return 'annual_leave';
  return '';
};

const localDateTimeToIso = (dateString, timeString) => {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString || '');
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeString || '');
  if (!dateMatch || !timeMatch) {
    throw new Error('Enter a valid date and time');
  }

  const [, yearText, monthText, dayText] = dateMatch;
  const [, hourText, minuteText] = timeMatch;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    throw new Error('Enter a valid local date and time');
  }

  return date.toISOString();
};

export default function Timesheets() {
  const requestIdRef = useRef(0);
  const [user, setUser] = useState(null);
  const [supabaseCompany, setSupabaseCompany] = useState(null);
  const [entries, setEntries] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 4 }));
  const [showAddModal, setShowAddModal] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [form, setForm] = useState({ job_id: '', date: format(new Date(), 'yyyy-MM-dd'), start_time: '', finish_time: '', lunch_break_mins: 0, notes: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteSavingId, setDeleteSavingId] = useState(null);
  const [myobExporting, setMyobExporting] = useState(false);
  const [myobProgress, setMyobProgress] = useState(0);

  const { company } = useCompany();

  useEffect(() => {
    if (!company) {
      setUser(null);
      setSupabaseCompany(null);
      setJobs([]);
      setEntries([]);
      setLoading(false);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setEntries([]);

    const loadTimesheets = async () => {
      try {
        const [profile, companyRows] = await Promise.all([
          onsiteApi.auth.me(),
          onsiteApi.tables.companies.list('name'),
        ]);
        if (requestId !== requestIdRef.current) return;

        const resolvedCompany = resolveSupabaseCompany(profile, companyRows);
        const [jobRows, timeEntryRows] = await Promise.all([
          onsiteApi.tables.jobs.filter({ company_id: resolvedCompany.id }),
          onsiteApi.tables.timeEntries.filter(
            { company_id: resolvedCompany.id, worker_id: profile.id },
            '-date'
          ),
        ]);
        if (requestId !== requestIdRef.current) return;

        setUser(profile);
        setSupabaseCompany(resolvedCompany);
        setJobs(jobRows);
        setEntries(sortEntries(timeEntryRows.filter(entry => isEntryInWeek(entry, weekStart))));
      } catch (error) {
        if (requestId === requestIdRef.current) {
          console.error('Failed to load Supabase timesheets:', error);
          setUser(null);
          setSupabaseCompany(null);
          setJobs([]);
          setEntries([]);
          toast.error('Failed to load timesheets');
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    loadTimesheets();
    return () => {
      requestIdRef.current += 1;
    };
  }, [company, weekStart]);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const getDayEntries = (day) =>
    entries
      .filter(e => e.date === format(day, 'yyyy-MM-dd') && e.status !== 'active')
      .sort((a, b) => {
        const ta = a.start_time ? new Date(a.start_time).getTime() : 0;
        const tb = b.start_time ? new Date(b.start_time).getTime() : 0;
        return ta - tb;
      });

  const totalWeekHours = entries
    .filter(e => e.status !== 'active')
    .reduce((sum, e) => sum + (e.total_hours || 0), 0);

  const openAdd = () => {
    setEditEntry(null);
    setForm({ job_id: '', date: format(new Date(), 'yyyy-MM-dd'), start_time: '', finish_time: '', lunch_break_mins: 0, notes: '' });
    setShowAddModal(true);
  };

  const openEdit = (entry) => {
    setEditEntry(entry);
    setForm({
      job_id: formJobIdFromEntry(entry),
      date: entry.date,
      start_time: entry.start_time ? format(parseISO(entry.start_time), "HH:mm") : '',
      finish_time: entry.finish_time ? format(parseISO(entry.finish_time), "HH:mm") : '',
      lunch_break_mins: entry.lunch_break_mins ?? 0,
      notes: entry.notes || '',
    });
    setShowAddModal(true);
  };

  const handleSave = async () => {
    if (saving) return;
    if (!supabaseCompany?.id || !user?.id) {
      toast.error('Supabase timesheets are not ready yet');
      return;
    }

    const isSickDay = form.job_id === 'sick_day';
    const isAnnualLeave = form.job_id === 'annual_leave';
    const isLeave = isSickDay || isAnnualLeave;
    const job = form.job_id && !isLeave ? jobs.find(j => j.id === form.job_id) : null;
    if (form.job_id && !isLeave && !job) {
      toast.error('Select a valid Supabase job');
      return;
    }

    const dateStr = form.date;
    let startISO;
    let finishISO;
    try {
      startISO = isLeave
        ? localDateTimeToIso(dateStr, '00:00')
        : (form.start_time ? localDateTimeToIso(dateStr, form.start_time) : null);
      finishISO = !isLeave && form.finish_time ? localDateTimeToIso(dateStr, form.finish_time) : null;
    } catch (error) {
      toast.error(error.message || 'Enter valid date and time values');
      return;
    }

    const data = {
      job_id: isLeave ? null : (job?.id || null),
      job_name: isLeave ? (isSickDay ? 'Sick Day' : 'Annual Leave') : (job?.job_name || ''),
      job_number: isLeave ? '' : (job?.job_number || ''),
      date: dateStr,
      start_time: startISO,
      finish_time: isLeave ? null : finishISO,
      lunch_break_mins: isLeave ? 0 : (form.lunch_break_mins ?? 0),
      notes: isLeave ? (isSickDay ? '🤒 Sick Day' : '🏖️ Annual Leave') : form.notes,
    };

    setSaving(true);
    try {
      if (editEntry) {
        const updatedEntry = await onsiteApi.tables.timeEntries.updateManual(editEntry.id, data);
        setEntries(currentEntries => {
          const withoutUpdated = currentEntries.filter(entry => entry.id !== updatedEntry.id);
          return isEntryInWeek(updatedEntry, weekStart)
            ? sortEntries([...withoutUpdated, updatedEntry])
            : sortEntries(withoutUpdated);
        });
        toast.success('Entry updated');
      } else {
        const newEntry = await onsiteApi.tables.timeEntries.createManual({
          ...data,
          company_id: supabaseCompany.id,
          worker_id: user.id,
        });
        setEntries(currentEntries =>
          isEntryInWeek(newEntry, weekStart)
            ? sortEntries([newEntry, ...currentEntries])
            : currentEntries
        );
        toast.success('Entry added');
      }

      setShowAddModal(false);
      setEditEntry(null);
    } catch (error) {
      console.error('Failed to save Supabase timesheet entry:', error);
      toast.error(error.message || 'Failed to save entry');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (deleteSavingId) return;
    setDeleteSavingId(id);
    try {
      await onsiteApi.tables.timeEntries.delete(id);
      setEntries(currentEntries => currentEntries.filter(entry => entry.id !== id));
      toast.success('Entry deleted');
    } catch (error) {
      console.error('Failed to delete Supabase timesheet entry:', error);
      toast.error(error.message || 'Failed to delete entry');
    } finally {
      setDeleteSavingId(null);
    }
  };

  const buildMyobCsv = () => {
    const rows = [
      ['Co./Last Name', 'First Name', 'Payroll Category', 'Date', 'Start Time', 'Finish Time', 'Hours', 'Job/Cost Centre', 'Notes'],
    ];
    const sorted = [...entries]
      .filter(e => e.status !== 'active')
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return (a.start_time || '') < (b.start_time || '') ? -1 : 1;
      });
    sorted.forEach(e => {
      const nameParts = (e.worker_name || '').trim().split(' ');
      const lastName = nameParts.slice(-1)[0] || '';
      const firstName = nameParts.slice(0, -1).join(' ') || '';
      rows.push([
        `"${lastName}"`,
        `"${firstName}"`,
        '"Ordinary Hours"',
        e.date ? format(parseISO(e.date), 'dd/MM/yyyy') : '',
        e.start_time ? format(parseISO(e.start_time), 'HH:mm') : '',
        e.finish_time ? format(parseISO(e.finish_time), 'HH:mm') : '',
        e.total_hours?.toFixed(2) || '0.00',
        `"${e.job_name || ''}"`,
        `"${e.job_number || ''}"`,
      ]);
    });
    return rows.map(r => r.join(',')).join('\n');
  };

  const exportMYOB = async () => {
    setMyobExporting(true);
    setMyobProgress(0);
    const steps = [15, 35, 55, 75, 90, 100];
    for (const pct of steps) {
      await new Promise(res => setTimeout(res, 400));
      setMyobProgress(pct);
    }
    const csv = buildMyobCsv();
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `MYOB-payroll-${format(weekStart, 'yyyy-MM-dd')}.csv`;
    a.click();
    await new Promise(res => setTimeout(res, 400));
    setMyobExporting(false);
    setMyobProgress(0);
  };

  const exportCSV = () => {
    const rows = [['Worker Name', 'Job Site', 'Job Number', 'Date', 'Start Time', 'Finish Time', 'Total Hours']];
    const sorted = [...entries]
      .filter(e => e.status !== 'active')
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return (a.start_time || '') < (b.start_time || '') ? -1 : 1;
      });
    sorted.forEach(e => {
      rows.push([
        e.worker_name || '',
        e.job_name || '',
        e.job_number || '',
        e.date || '',
        e.start_time ? format(parseISO(e.start_time), 'HH:mm') : '',
        e.finish_time ? format(parseISO(e.finish_time), 'HH:mm') : '',
        e.total_hours?.toFixed(2) || '',
      ]);
    });
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `timesheet-${format(weekStart, 'yyyy-MM-dd')}.csv`;
    a.click();
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="px-6 pt-14 pb-4 flex items-center gap-4">
        <Link to="/" className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-black flex-1">Timesheets</h1>
        <button onClick={exportMYOB} disabled={myobExporting} className="w-9 h-9 rounded-xl bg-blue-500/20 flex items-center justify-center disabled:opacity-60">
          {myobExporting ? <Loader2 className="w-4 h-4 text-blue-400 animate-spin" /> : <FileText className="w-4 h-4 text-blue-400" />}
        </button>
        <button onClick={exportCSV} className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
          <Download className="w-4 h-4" />
        </button>
        <button onClick={openAdd} className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
          <Plus className="w-4 h-4 text-primary-foreground" />
        </button>
      </div>

      {/* Week Navigator */}
      <div className="px-6 mb-4">
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => setWeekStart(d => addDays(d, -7))} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center" >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-center">
              <p className="font-bold text-sm">{format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d, yyyy')}</p>
              <p className="text-xs text-primary font-mono font-bold mt-0.5">{totalWeekHours.toFixed(2)} hrs total</p>
            </div>
            <button onClick={() => setWeekStart(d => addDays(d, 7))} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Day Pills */}
          <div className="flex gap-1">
            {weekDays.map(day => {
              const dayEntries = getDayEntries(day);
              const isToday = isSameDay(day, new Date());
              const hasEntries = dayEntries.length > 0;
              return (
                <div key={day.toISOString()} className={`flex-1 rounded-xl py-2 flex flex-col items-center gap-1 ${isToday ? 'bg-primary/15 border border-primary/30' : 'bg-muted/50'}`}>
                  <span className="text-[9px] text-muted-foreground font-medium uppercase">{format(day, 'EEE')}</span>
                  <span className={`text-sm font-bold ${isToday ? 'text-primary' : 'text-foreground'}`}>{format(day, 'd')}</span>
                  {hasEntries && <div className="w-1.5 h-1.5 rounded-full bg-green-400" />}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Day-by-day entries */}
      <div className="px-6 space-y-3 pb-4">
        {weekDays.map(day => {
          const dayEntries = getDayEntries(day);
          if (dayEntries.length === 0) return null;
          return (
            <div key={day.toISOString()}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {format(day, 'EEEE, MMMM d')}
              </p>
              {dayEntries.map(entry => (
                <div key={entry.id} className="bg-card border border-border rounded-2xl p-4 mb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
                        <Clock className="w-5 h-5 text-amber-400" />
                      </div>
                      <div>
                        <p className="font-bold text-sm">{entry.job_name}</p>
                        <p className="text-xs text-muted-foreground font-mono">#{entry.job_number}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {entry.start_time ? format(parseISO(entry.start_time), 'h:mm a') : '—'} → {entry.finish_time ? format(parseISO(entry.finish_time), 'h:mm a') : '—'}
                        </p>
                        {entry.lunch_break_mins > 0 && (
                          <p className="text-xs text-amber-400 mt-0.5">🍽️ {entry.lunch_break_mins} min lunch</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right mr-2">
                        <p className="text-primary font-bold font-mono">{(entry.total_hours || 0).toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">hrs</p>
                      </div>
                      <button onClick={() => openEdit(entry)} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => handleDelete(entry.id)}
                        disabled={deleteSavingId === entry.id}
                        className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center disabled:opacity-50"
                      >
                        {deleteSavingId === entry.id
                          ? <Loader2 className="w-3.5 h-3.5 text-destructive animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5 text-destructive" />}
                      </button>
                    </div>
                  </div>
                  {entry.notes && <p className="text-xs text-muted-foreground mt-2 pl-13">{entry.notes}</p>}
                </div>
              ))}
            </div>
          );
        })}

        {loading && entries.length === 0 && (
          <div className="text-center py-16">
            <Loader2 className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3 animate-spin" />
            <p className="text-muted-foreground">Loading timesheets...</p>
          </div>
        )}

        {!loading && entries.filter(e => e.status !== 'active').length === 0 && (
          <div className="text-center py-16">
            <Clock className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">No entries this week</p>
            <p className="text-muted-foreground/60 text-sm mt-1">Clock in to a job or add manually</p>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-card border-t border-border rounded-t-3xl p-6 pb-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-black">{editEntry ? 'Edit Entry' : 'Add Entry'}</h3>
              <button onClick={() => !saving && setShowAddModal(false)} disabled={saving} className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center disabled:opacity-50">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Job Site</label>
                <select value={form.job_id} onChange={e => setForm(f => ({ ...f, job_id: e.target.value }))}
                  className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground outline-none">
                  <option value="">Select job...</option>
                  <option value="sick_day">🤒 Sick Day</option>
                  <option value="annual_leave">🏖️ Annual Leave</option>
                  {jobs.map(j => <option key={j.id} value={j.id} className="bg-card">{j.job_name} #{j.job_number}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Date</label>
                <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block">Start Time</label>
                  <input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))}
                    className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground outline-none" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block">Finish Time</label>
                  <input type="time" value={form.finish_time} onChange={e => setForm(f => ({ ...f, finish_time: e.target.value }))}
                    className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">🍽️ Lunch Break</label>
                <select value={form.lunch_break_mins} onChange={e => setForm(f => ({ ...f, lunch_break_mins: Number(e.target.value) }))}
                  className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground outline-none">
                  <option value={0}>No lunch break</option>
                  <option value={30}>30 minutes</option>
                  <option value={45}>45 minutes</option>
                  <option value={60}>60 minutes</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Notes</label>
                <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional notes..."
                  className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground outline-none placeholder:text-muted-foreground/50" />
              </div>
            </div>

            <button onClick={handleSave} disabled={saving || loading} className="w-full mt-6 py-4 rounded-2xl bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2 disabled:opacity-60">
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
              {saving ? 'Saving...' : 'Save Entry'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
