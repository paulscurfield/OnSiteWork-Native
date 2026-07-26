import { useState, useEffect } from 'react';
import { useCompany } from '@/lib/companyContext';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Clock, Plus, Pencil, Trash2, Download, X, Check, FileText, Loader2 } from 'lucide-react';
import { format, startOfWeek, addDays, isSameDay, parseISO } from 'date-fns';

export default function Timesheets() {
  const [user, setUser] = useState(null);
  const [entries, setEntries] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 4 }));
  const [showAddModal, setShowAddModal] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [form, setForm] = useState({ job_id: '', date: format(new Date(), 'yyyy-MM-dd'), start_time: '', finish_time: '', lunch_break_mins: 0, notes: '' });
  const [myobExporting, setMyobExporting] = useState(false);
  const [myobProgress, setMyobProgress] = useState(0);

  const { company } = useCompany();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
    if (company) base44.entities.Job.filter({ company_id: company.id }).then(setJobs);
  }, [company]);

  useEffect(() => {
    if (user) loadEntries();
  }, [user, weekStart]);

  const loadEntries = async () => {
    const start = format(weekStart, 'yyyy-MM-dd');
    const end = format(addDays(weekStart, 6), 'yyyy-MM-dd');
    const all = await base44.entities.TimeEntry.filter({ company_id: company?.id, worker_email: user.email });
    const filtered = all
      .filter(e => e.date >= start && e.date <= end)
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        const ta = a.start_time ? new Date(a.start_time).getTime() : 0;
        const tb = b.start_time ? new Date(b.start_time).getTime() : 0;
        return ta - tb;
      });
    setEntries(filtered);
  };

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
      job_id: entry.job_id,
      date: entry.date,
      start_time: entry.start_time ? format(parseISO(entry.start_time), "HH:mm") : '',
      finish_time: entry.finish_time ? format(parseISO(entry.finish_time), "HH:mm") : '',
      lunch_break_mins: entry.lunch_break_mins || 0,
      notes: entry.notes || '',
    });
    setShowAddModal(true);
  };

  const handleSave = async () => {
    const isSickDay = form.job_id === 'sick_day';
    const isAnnualLeave = form.job_id === 'annual_leave';
    const isLeave = isSickDay || isAnnualLeave;
    const job = isLeave ? null : jobs.find(j => j.id === form.job_id);
    const dateStr = form.date;
    const startISO = form.start_time ? `${dateStr}T${form.start_time}:00` : null;
    const finishISO = form.finish_time ? `${dateStr}T${form.finish_time}:00` : null;

    let totalHours = 0;
    if (!isLeave && startISO && finishISO) {
      const rawHours = (new Date(finishISO).getTime() - new Date(startISO).getTime()) / 3600000;
      totalHours = Math.round((rawHours - (form.lunch_break_mins || 0) / 60) * 100) / 100;
    }

    const data = {
      company_id: company?.id,
      worker_email: user.email,
      worker_name: user.full_name,
      job_id: form.job_id,
      job_name: isLeave ? (isSickDay ? 'Sick Day' : 'Annual Leave') : (job?.job_name || ''),
      job_number: isLeave ? '' : (job?.job_number || ''),
      date: dateStr,
      start_time: isLeave ? `${dateStr}T00:00:00` : startISO,
      finish_time: isLeave ? null : finishISO,
      lunch_break_mins: isLeave ? 0 : (form.lunch_break_mins || 0),
      total_hours: totalHours,
      status: 'manual',
      notes: isLeave ? (isSickDay ? '🤒 Sick Day' : '🏖️ Annual Leave') : form.notes,
    };

    if (editEntry) {
      await base44.entities.TimeEntry.update(editEntry.id, data);
    } else {
      await base44.entities.TimeEntry.create(data);
    }

    setShowAddModal(false);
    loadEntries();
  };

  const handleDelete = async (id) => {
    await base44.entities.TimeEntry.delete(id);
    loadEntries();
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
                      <button onClick={() => handleDelete(entry.id)} className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center">
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </button>
                    </div>
                  </div>
                  {entry.notes && <p className="text-xs text-muted-foreground mt-2 pl-13">{entry.notes}</p>}
                </div>
              ))}
            </div>
          );
        })}

        {entries.filter(e => e.status !== 'active').length === 0 && (
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
              <button onClick={() => setShowAddModal(false)} className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center">
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

            <button onClick={handleSave} className="w-full mt-6 py-4 rounded-2xl bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2">
              <Check className="w-5 h-5" />
              Save Entry
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
