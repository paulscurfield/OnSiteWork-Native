import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/companyContext';
import { Link } from 'react-router-dom';
import { ChevronLeft, Plus, Pencil, Trash2, Download, Users, Clock, X, Check, MapPin, FileText, UserPlus, Mail, Loader2, Camera, AlertTriangle } from 'lucide-react';
import { format, parseISO, startOfWeek, addDays } from 'date-fns';
import { toast } from 'sonner';

const tabs = ['Jobs', 'Timesheets', 'Workers', 'Photos', 'Pre-Starts'];

/**
 * @typedef {{
 *   job_id: string,
 *   date: string,
 *   start_time: string,
 *   finish_time: string,
 *   lunch_break_mins: number,
 *   notes: string
 * }} AdminEditEntryForm
 */

export default function Admin() {
  const { company } = useCompany();
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState('Jobs');
  const [jobs, setJobs] = useState([]);
  const [entries, setEntries] = useState([]);
  const [users, setUsers] = useState([]);
  const [showJobModal, setShowJobModal] = useState(false);
  const [editJob, setEditJob] = useState(null);
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 4 }));
  const [jobForm, setJobForm] = useState({ job_name: '', job_number: '', location_address: '', latitude: '', longitude: '', notes: '', status: 'active' });
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('user');
  const [inviting, setInviting] = useState(false);
  const [myobExporting, setMyobExporting] = useState(false);
  const [myobProgress, setMyobProgress] = useState(0);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailAddress, setEmailAddress] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [workerToRemove, setWorkerToRemove] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [showMyobPickerModal, setShowMyobPickerModal] = useState(false);
  const [selectedWorkerEmails, setSelectedWorkerEmails] = useState([]);
  const [editEntry, setEditEntry] = useState(null);
  const [editForm, setEditForm] = useState(/** @type {AdminEditEntryForm} */ ({}));
  const [editSaving, setEditSaving] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [photoFilter, setPhotoFilter] = useState('');
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const [preStarts, setPreStarts] = useState([]);
  const [preStartFilter, setPreStartFilter] = useState('');
  const [expandedPreStart, setExpandedPreStart] = useState(null);
  const [showPreStartEmailModal, setShowPreStartEmailModal] = useState(false);
  const [preStartEmailAddress, setPreStartEmailAddress] = useState('');
  const [sendingPreStartEmail, setSendingPreStartEmail] = useState(false);
  const [selectedPreStarts, setSelectedPreStarts] = useState([]);
  const [preStartSelectMode, setPreStartSelectMode] = useState(false);
  const [addDayWorker, setAddDayWorker] = useState(null);
  const [addDayForm, setAddDayForm] = useState({ date: '', job_id: '', start_time: '', finish_time: '', lunch_break_mins: 0, notes: '' });
  const [addDaySaving, setAddDaySaving] = useState(false);
  const [showWorkerPicker, setShowWorkerPicker] = useState(false);

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      setCheckingAuth(false);
      loadAll();
    }).catch(() => setCheckingAuth(false));
  }, []);

  useEffect(() => {
    if (activeTab === 'Timesheets') loadEntries();
    if (activeTab === 'Photos') loadPhotos();
    if (activeTab === 'Pre-Starts') loadPreStarts();
  }, [activeTab, weekStart]);

  const loadPhotos = async () => {
    const all = await base44.entities.JobPhoto.filter({ company_id: company?.id }, '-created_date', 200);
    setPhotos(all);
  };

  const exportPreStartsCSV = () => {
    const filtered = preStarts.filter(p => !preStartFilter || p.worker_email === preStartFilter);
    const rows = [['Date', 'Worker', 'Vehicle', 'Job', 'Status', 'Hours/Kms', ...PRESTART_QUESTIONS.map((_, i) => `Q${i + 2}`), 'General Comments']];
    filtered.forEach(ps => {
      const answers = ps.answers || {};
      rows.push([
        ps.date || '',
        ps.worker_name || '',
        ps.equipment_name || '',
        ps.job_name || '',
        ps.status || '',
        answers[1] || '',
        ...Array.from({ length: 19 }, (_, i) => answers[i + 2] || ''),
        ps.general_comments || '',
      ]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pre-starts${preStartFilter ? '-' + preStartFilter : ''}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    toast.success('Pre-starts CSV exported!');
  };

  const PRESTART_QUESTION_LABELS = [
    "Hours / KMs on asset",
    "Is the asset due for a service?",
    "Do you hold the appropriate License, Qualification or Competency?",
    "Are you Fit for Duty?",
    "Do you understand the PPE requirements?",
    "Have you read and understood the Safe Work Method Statement?",
    "Engine oil, hydraulic oil, coolant, water and fuel — no leaks?",
    "Tyres & Wheel Assembly condition?",
    "Grease applied to all grease points?",
    "General Body Condition?",
    "Lights and Warning Devices?",
    "E-Stop working?",
    "Fire extinguisher attached and serviced?",
    "Battery secure and terminals clean?",
    "Brakes and Air Systems?",
    "Steering working correctly?",
    "Loading bucket in serviceable condition?",
    "Safety stickers present and in good condition?",
    "Two-way radio working and on correct channel?",
    "General Comments",
  ];

  const handlePreStartEmailExport = async () => {
    if (!preStartEmailAddress) { toast.error('Enter an email address'); return; }
    setSendingPreStartEmail(true);
    const filtered = selectedPreStarts.length > 0
      ? preStarts.filter(p => selectedPreStarts.includes(p.id))
      : preStarts.filter(p => !preStartFilter || p.worker_email === preStartFilter);
    const faultCount = filtered.filter(p => p.status === 'fault').length;
    const passCount = filtered.filter(p => p.status === 'pass').length;

    const recordDetails = filtered.map(ps => {
      const answers = ps.answers || {};
      const qaLines = PRESTART_QUESTION_LABELS.map((label, idx) => {
        const qId = idx + 1;
        const answer = answers[qId] || '(not answered)';
        return `  Q${qId}. ${label}\n      → ${answer}`;
      }).join('\n');
      return `─────────────────────────────────────
Date: ${ps.date}  |  Worker: ${ps.worker_name}
Vehicle: ${ps.equipment_name}  |  Job: ${ps.job_name || 'No job'}${ps.job_number ? ` #${ps.job_number}` : ''}
Status: ${ps.status?.toUpperCase() === 'FAULT' ? '⚠ FAULT' : '✓ PASS'}

${qaLines}${ps.general_comments ? `\n\n  General Comments: "${ps.general_comments}"` : ''}`;
    }).join('\n\n');

    const body = `Hi,

Please find below the full Pre-Start Checklist report exported from OnSite Timesheet.

SUMMARY
────────────────────────────────────
Total records: ${filtered.length}
Passed: ${passCount}
Faults reported: ${faultCount}
Date exported: ${format(new Date(), 'd MMM yyyy')}

FULL CHECKLIST RECORDS
${recordDetails}

─────────────────────────────────────
Regards,
OnSite Timesheet`;

    await base44.integrations.Core.SendEmail({
      to: preStartEmailAddress,
      subject: `Pre-Start Checklist Report – ${format(new Date(), 'd MMM yyyy')}`,
      body,
    });
    toast.success(`Pre-start report emailed to ${preStartEmailAddress}`);
    setSendingPreStartEmail(false);
    setShowPreStartEmailModal(false);
    setPreStartEmailAddress('');
    setSelectedPreStarts([]);
    setPreStartSelectMode(false);
  };

  const PRESTART_QUESTIONS = Array.from({ length: 19 }, (_, i) => i + 2);

  const loadPreStarts = async () => {
    const all = await base44.entities.PreStart.filter({ company_id: company?.id }, '-created_date', 200);
    setPreStarts(all);
  };

  const loadAll = async () => {
    const [j, allEntries, usersRes] = await Promise.all([
      base44.entities.Job.filter({ company_id: company?.id }, '-created_date'),
      base44.entities.TimeEntry.filter({ company_id: company?.id }, '-date', 500),
      base44.functions.invoke('getCompanyUsers', {}),
    ]);
    setJobs(j);

    // Build worker map - start with actual registered company users
    const workerMap = {};
    (usersRes?.data?.users || []).forEach(u => {
      workerMap[u.email] = { email: u.email, name: u.full_name || u.email, role: u.role };
    });
    // Also add anyone with time entries (catches edge cases)
    allEntries.forEach(e => {
      if (e.worker_email && !workerMap[e.worker_email]) {
        workerMap[e.worker_email] = { email: e.worker_email, name: e.worker_name };
      }
    });
    setUsers(Object.values(workerMap));
  };

  const loadEntries = async () => {
    const start = format(weekStart, 'yyyy-MM-dd');
    const end = format(addDays(weekStart, 6), 'yyyy-MM-dd');
    const all = await base44.entities.TimeEntry.filter({ company_id: company?.id }, '-date');
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

  const openAddJob = () => {
    setEditJob(null);
    setJobForm({ job_name: '', job_number: '', location_address: '', latitude: '', longitude: '', notes: '', status: 'active' });
    setShowJobModal(true);
  };

  const openEditJob = (job) => {
    setEditJob(job);
    setJobForm({
      job_name: job.job_name || '',
      job_number: job.job_number || '',
      location_address: job.location_address || '',
      latitude: job.latitude || '',
      longitude: job.longitude || '',
      notes: job.notes || '',
      status: job.status || 'active',
    });
    setShowJobModal(true);
  };

  const handleSaveJob = async () => {
    const data = {
      ...jobForm,
      latitude: jobForm.latitude ? parseFloat(jobForm.latitude) : null,
      longitude: jobForm.longitude ? parseFloat(jobForm.longitude) : null,
    };
    if (editJob) {
      await base44.entities.Job.update(editJob.id, data);
      toast.success('Job updated!');
    } else {
      await base44.entities.Job.create({ ...data, company_id: company?.id });
      toast.success('Job created!');
    }
    setShowJobModal(false);
    loadAll();
  };

  const handleDeleteJob = async (id) => {
    await base44.entities.Job.delete(id);
    toast.success('Job deleted');
    loadAll();
  };

  const exportCSV = () => {
    const rows = [['Worker Name', 'Job Site', 'Job Number', 'Date', 'Start Time', 'Finish Time', 'Total Hours']];
    entries.forEach(e => {
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
    a.download = `payroll-${format(weekStart, 'yyyy-MM-dd')}.csv`;
    a.click();
    toast.success('CSV exported!');
  };

  // Build MYOB-format CSV content
  // MYOB Timesheets Import format: Employee Card ID, Payroll Category, Date, Hours
  const buildMyobCsv = (filteredEntries) => {
    const rows = [
      ['Co./Last Name', 'First Name', 'Payroll Category', 'Date', 'Start Time', 'Finish Time', 'Hours', 'Job/Cost Centre', 'Notes'],
    ];
    filteredEntries.forEach(e => {
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

  const doMYOBDownload = async (filteredEntries, filename) => {
    setMyobExporting(true);
    setMyobProgress(0);
    const steps = [15, 35, 55, 75, 90, 100];
    for (const pct of steps) {
      await new Promise(res => setTimeout(res, 300));
      setMyobProgress(pct);
    }
    const csv = buildMyobCsv(filteredEntries);
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    await new Promise(res => setTimeout(res, 300));
    setMyobExporting(false);
    setMyobProgress(0);
    toast.success('MYOB CSV exported!');
  };

  const exportMYOB = () => {
    // Open picker modal — pre-select all workers
    setSelectedWorkerEmails(Object.keys(workerGroups));
    setShowMyobPickerModal(true);
  };

  const handleMyobPickerExport = () => {
    setShowMyobPickerModal(false);
    const filtered = entries.filter(e => selectedWorkerEmails.includes(e.worker_email));
    const names = selectedWorkerEmails.map(email => workerGroups[email]?.name?.split(' ').join('_') || email).join('-');
    doMYOBDownload(filtered, `MYOB-payroll-${names}-${format(weekStart, 'yyyy-MM-dd')}.csv`);
  };

  const exportWorkerMYOB = (worker) => {
    doMYOBDownload(worker.entries, `MYOB-${worker.name?.split(' ').join('_')}-${format(weekStart, 'yyyy-MM-dd')}.csv`);
  };

  const handleEmailExport = async () => {
    if (!emailAddress) { toast.error('Enter an email address'); return; }
    setSendingEmail(true);
    const csv = buildMyobCsv(entries);
    const weekLabel = `${format(weekStart, 'd MMM')} – ${format(addDays(weekStart, 6), 'd MMM yyyy')}`;
    const body = `Hi,\n\nPlease find attached the MYOB-ready payroll timesheet export for the week of ${weekLabel}.\n\nSummary:\n- Total entries: ${entries.length}\n- Total hours: ${totalHours.toFixed(2)} hrs\n- Workers: ${[...new Set(entries.map(e => e.worker_name))].join(', ')}\n\nThis file is formatted for direct import into MYOB.\n\nRegards,\nOnSite Timesheet`;
    await base44.integrations.Core.SendEmail({
      to: emailAddress,
      subject: `MYOB Payroll Export – Week of ${weekLabel}`,
      body,
    });
    toast.success(`Payroll report emailed to ${emailAddress}`);
    setSendingEmail(false);
    setShowEmailModal(false);
    setEmailAddress('');
  };

  const totalHours = entries.reduce((sum, e) => sum + (e.total_hours || 0), 0);

  // Group entries by worker
  const workerGroups = entries.reduce((acc, e) => {
    const key = e.worker_email;
    if (!acc[key]) acc[key] = { name: e.worker_name, email: e.worker_email, entries: [] };
    acc[key].entries.push(e);
    return acc;
  }, {});

  const openAddDay = (worker) => {
    setAddDayWorker(worker);
    setAddDayForm({ date: '', job_id: '', start_time: '', finish_time: '', lunch_break_mins: 0, notes: '' });
  };

  const handleSaveAddDay = async () => {
    if (!addDayForm.date || !addDayForm.job_id) {
      toast.error('Date and job are required');
      return;
    }
    if (!['sick_day', 'annual_leave'].includes(addDayForm.job_id) && !addDayForm.start_time) {
      toast.error('Start time is required');
      return;
    }
    setAddDaySaving(true);
    const isSickDay = addDayForm.job_id === 'sick_day';
    const isAnnualLeave = addDayForm.job_id === 'annual_leave';
    const isLeaveEntry = isSickDay || isAnnualLeave;
    const job = isLeaveEntry ? null : jobs.find(j => j.id === addDayForm.job_id);
    const startISO = addDayForm.start_time ? `${addDayForm.date}T${addDayForm.start_time}:00` : `${addDayForm.date}T00:00:00`;
    const finishISO = addDayForm.finish_time ? `${addDayForm.date}T${addDayForm.finish_time}:00` : null;
    let totalHoursCalc = 0;
    if (!isLeaveEntry && finishISO) {
      const rawHours = (new Date(finishISO) - new Date(startISO)) / 3600000;
      totalHoursCalc = Math.round((rawHours - (addDayForm.lunch_break_mins || 0) / 60) * 100) / 100;
    }
    const leaveLabel = isSickDay ? 'Sick Day' : 'Annual Leave';
    const leaveNote = isSickDay ? '🤒 Sick Day' : '🏖️ Annual Leave';
    await base44.entities.TimeEntry.create({
      company_id: company?.id,
      worker_email: addDayWorker.email,
      worker_name: addDayWorker.name,
      job_id: isLeaveEntry ? addDayForm.job_id : addDayForm.job_id,
      job_name: isLeaveEntry ? leaveLabel : (job?.job_name || ''),
      job_number: isLeaveEntry ? '' : (job?.job_number || ''),
      date: addDayForm.date,
      start_time: startISO,
      finish_time: finishISO,
      lunch_break_mins: isLeaveEntry ? 0 : addDayForm.lunch_break_mins,
      total_hours: totalHoursCalc,
      status: 'manual',
      notes: isLeaveEntry ? leaveNote : addDayForm.notes,
    });
    toast.success('Day added!');
    setAddDayWorker(null);
    setAddDaySaving(false);
    loadEntries();
  };

  const openEditEntry = (e) => {
    setEditEntry(e);
    setEditForm({
      job_id: e.job_id || '',
      date: e.date || '',
      start_time: e.start_time ? format(parseISO(e.start_time), 'HH:mm') : '',
      finish_time: e.finish_time ? format(parseISO(e.finish_time), 'HH:mm') : '',
      lunch_break_mins: e.lunch_break_mins || 0,
      notes: e.notes || '',
    });
  };

  const handleSaveEntry = async () => {
    setEditSaving(true);
    const dateStr = editForm.date || editEntry.date;
    const startISO = editForm.start_time ? `${dateStr}T${editForm.start_time}:00` : null;
    const finishISO = editForm.finish_time ? `${dateStr}T${editForm.finish_time}:00` : null;
    let totalHoursCalc = editEntry.total_hours;
    if (startISO && finishISO) {
      const rawHours = (new Date(finishISO) - new Date(startISO)) / 3600000;
      totalHoursCalc = Math.round((rawHours - (editForm.lunch_break_mins || 0) / 60) * 100) / 100;
    }
    const job = jobs.find(j => j.id === editForm.job_id);
    await base44.entities.TimeEntry.update(editEntry.id, {
      job_id: editForm.job_id,
      job_name: job?.job_name || editEntry.job_name,
      job_number: job?.job_number || editEntry.job_number,
      date: dateStr,
      start_time: startISO,
      finish_time: finishISO,
      lunch_break_mins: editForm.lunch_break_mins,
      total_hours: totalHoursCalc,
      notes: editForm.notes,
    });
    toast.success('Entry updated');
    setEditEntry(null);
    setEditSaving(false);
    loadEntries();
  };

  const handleDeleteEntry = async (id) => {
    await base44.entities.TimeEntry.delete(id);
    toast.success('Entry deleted');
    setEditEntry(null);
    loadEntries();
  };

  const handleRemoveWorker = async () => {
    if (!workerToRemove) return;
    setRemoving(true);
    // Delete all time entries for this worker
    const workerEntries = await base44.entities.TimeEntry.filter({ worker_email: workerToRemove.email });
    await Promise.all(workerEntries.map(e => base44.entities.TimeEntry.delete(e.id)));
    setUsers(users.filter(u => u.email !== workerToRemove.email));
    toast.success(`${workerToRemove.name} removed`);
    setRemoving(false);
    setShowRemoveModal(false);
    setWorkerToRemove(null);
  };

  const handleInviteWorker = async () => {
    if (!inviteEmail) { toast.error('Enter an email address'); return; }
    setInviting(true);
    await base44.users.inviteUser(inviteEmail, inviteRole);
    toast.success(`Invite sent to ${inviteEmail}`);
    setInviteEmail('');
    setInviteRole('user');
    setShowInviteModal(false);
    setInviting(false);
  };



  if (checkingAuth) return null;

  const isAdmin = user?.role === 'admin' || (company && company.owner_email === user?.email);

  if (!user || !isAdmin) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-8 text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h1 className="text-xl font-black mb-2">Access Denied</h1>
        <p className="text-muted-foreground text-sm mb-6">You need admin privileges to view this page.</p>
        <Link to="/" className="px-6 py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm">Go Home</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="px-6 pt-14 pb-4 flex items-center gap-4">
        <Link to="/" className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-black flex-1">Admin Panel</h1>
      </div>

      {/* Tab Bar */}
      <div className="px-6 mb-4">
        <div className="flex bg-card border border-border rounded-2xl p-1 gap-1">
          {tabs.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${activeTab === tab ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Jobs Tab */}
      {activeTab === 'Jobs' && (
        <div className="px-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">{jobs.length} job sites</p>
            <button onClick={openAddJob} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold">
              <Plus className="w-4 h-4" /> Add Job
            </button>
          </div>
          <div className="space-y-3">
            {jobs.map(job => (
              <div key={job.id} className="bg-card border border-border rounded-2xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-bold">{job.job_name}</p>
                    <p className="text-xs text-muted-foreground font-mono">#{job.job_number}</p>
                    {job.location_address && (
                      <div className="flex items-center gap-1 mt-1">
                        <MapPin className="w-3 h-3 text-muted-foreground/60" />
                        <p className="text-xs text-muted-foreground/60">{job.location_address}</p>
                      </div>
                    )}
                    {job.notes && <p className="text-xs text-muted-foreground mt-1">{job.notes}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => openEditJob(job)} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                    <button onClick={() => handleDeleteJob(job.id)} className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center">
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timesheets Tab */}
      {activeTab === 'Timesheets' && (
        <div className="px-6">
          {/* Week navigator */}
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setWeekStart(d => addDays(d, -7))} className="px-3 py-2 rounded-xl bg-secondary text-sm font-semibold">← Prev</button>
            <div className="text-center">
              <p className="font-bold text-sm">{format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d')}</p>
              <p className="text-xs text-primary font-mono">{totalHours.toFixed(2)} total hrs</p>
            </div>
            <button onClick={() => setWeekStart(d => addDays(d, 7))} className="px-3 py-2 rounded-xl bg-secondary text-sm font-semibold">Next →</button>
          </div>

          {/* Export Buttons */}
          <div className="flex gap-2 mb-4">
            <button onClick={exportCSV} className="flex-1 py-3 rounded-2xl bg-green-500/15 border border-green-500/30 text-green-400 font-bold flex items-center justify-center gap-2 text-sm">
              <Download className="w-4 h-4" />
              Export CSV
            </button>
            <button onClick={exportMYOB} disabled={myobExporting} className="flex-1 py-3 rounded-2xl bg-blue-500/15 border border-blue-500/30 text-blue-400 font-bold flex items-center justify-center gap-2 text-sm disabled:opacity-60">
              <FileText className="w-4 h-4" />
              MYOB Export
            </button>
            <button onClick={() => setShowEmailModal(true)} className="w-12 py-3 rounded-2xl bg-purple-500/15 border border-purple-500/30 text-purple-400 font-bold flex items-center justify-center">
              <Mail className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3 pb-6">
            {entries.length === 0 ? (
              <div className="text-center py-12">
                <Clock className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">No entries this week</p>
              </div>
            ) : Object.values(workerGroups).map(worker => {
              const workerTotal = worker.entries.reduce((sum, e) => sum + (e.total_hours || 0), 0);
              return (
                <div key={worker.email} className="bg-card border border-border rounded-2xl overflow-hidden">
                  {/* Worker header */}
                  <div className="flex items-center gap-3 px-4 py-3 bg-muted/40 border-b border-border">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-black text-primary">{worker.name?.charAt(0)?.toUpperCase() || '?'}</span>
                    </div>
                    <p className="font-bold flex-1">{worker.name}</p>
                    <span className="text-xs text-muted-foreground mr-2">{worker.entries.length} entr{worker.entries.length !== 1 ? 'ies' : 'y'}</span>
                    <button
                      onClick={() => openAddDay(worker)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/15 border border-primary/30 text-primary text-xs font-semibold"
                    >
                      <Plus className="w-3 h-3" />
                      Add Day
                    </button>
                  </div>

                  {/* Daily entries */}
                  <div className="divide-y divide-border">
                    {worker.entries.map(e => (
                      <div key={e.id} className="flex items-center gap-2 px-4 py-2.5">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-semibold text-foreground">{format(parseISO(e.date), 'EEE d MMM')}</span>
                            <span className="text-xs text-muted-foreground">· {e.job_name}</span>
                            {e.status === 'active' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 font-semibold">● Live</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {e.start_time ? format(parseISO(e.start_time), 'h:mm a') : '—'} → {e.finish_time ? format(parseISO(e.finish_time), 'h:mm a') : 'ongoing'}
                            {e.lunch_break_mins > 0 && ` · 🍽️ ${e.lunch_break_mins}m`}
                          </p>
                        </div>
                        <p className="text-primary font-mono font-bold text-sm flex-shrink-0">
                          {e.status === 'active' ? '—' : `${(e.total_hours || 0).toFixed(2)}h`}
                        </p>
                        <button onClick={() => openEditEntry(e)}
                          className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                          <Pencil className="w-3 h-3 text-muted-foreground" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Weekly total footer */}
                  <div className="flex items-center justify-between px-4 py-3 bg-primary/5 border-t border-primary/20">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Week Total</span>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-primary font-mono">{workerTotal.toFixed(2)} hrs</span>
                      <button
                        onClick={() => exportWorkerMYOB(worker)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-400 text-xs font-semibold"
                      >
                        <FileText className="w-3 h-3" />
                        MYOB
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add Day Modal */}
      {addDayWorker && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end justify-center" onClick={() => setAddDayWorker(null)}>
          <div className="bg-card border border-border rounded-t-3xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-lg font-black">Add Missed Day</h2>
                <p className="text-xs text-muted-foreground">{addDayWorker.name}</p>
              </div>
              <button onClick={() => setAddDayWorker(null)} className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date</label>
                <input type="date" value={addDayForm.date}
                  onChange={e => setAddDayForm(f => ({ ...f, date: e.target.value }))}
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Job Site</label>
                <select value={addDayForm.job_id}
                  onChange={e => setAddDayForm(f => ({ ...f, job_id: e.target.value }))}
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary">
                  <option value="">Select job...</option>
                  <option value="sick_day">🤒 Sick Day</option>
                  <option value="annual_leave">🏖️ Annual Leave</option>
                  {jobs.map(j => (
                    <option key={j.id} value={j.id}>{j.job_name} #{j.job_number}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Start Time</label>
                  <input type="time" value={addDayForm.start_time}
                    onChange={e => setAddDayForm(f => ({ ...f, start_time: e.target.value }))}
                    className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Finish Time</label>
                  <input type="time" value={addDayForm.finish_time}
                    onChange={e => setAddDayForm(f => ({ ...f, finish_time: e.target.value }))}
                    className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">🍽️ Lunch Break</label>
                <select value={addDayForm.lunch_break_mins}
                  onChange={e => setAddDayForm(f => ({ ...f, lunch_break_mins: Number(e.target.value) }))}
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary">
                  <option value={0}>No lunch break</option>
                  <option value={30}>30 minutes</option>
                  <option value={45}>45 minutes</option>
                  <option value={60}>60 minutes</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notes (optional)</label>
                <input value={addDayForm.notes}
                  onChange={e => setAddDayForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="e.g. forgot to clock in"
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
              </div>
            </div>
            <button onClick={handleSaveAddDay} disabled={addDaySaving}
              className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-60 transition-all active:scale-95 flex items-center justify-center gap-2">
              <Check className="w-4 h-4" />
              {addDaySaving ? 'Saving...' : 'Add Day'}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Worker Picker Modal */}
      {showWorkerPicker && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end justify-center" onClick={() => setShowWorkerPicker(false)}>
          <div className="bg-card border border-border rounded-t-3xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-black">Select Worker</h2>
              <button onClick={() => setShowWorkerPicker(false)} className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {users.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No workers found. Workers appear here once they've logged time.</p>
              ) : users.map(u => (
                <button key={u.email}
                  onClick={() => { openAddDay(u); setShowWorkerPicker(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-muted/40 border border-border hover:bg-muted transition-all text-left">
                  <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <span className="font-black text-primary text-sm">{u.name?.charAt(0)?.toUpperCase() || '?'}</span>
                  </div>
                  <div>
                    <p className="font-bold text-sm">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Photos Tab */}
      {activeTab === 'Photos' && (
        <div className="px-6 pb-6">
          <div className="flex items-center gap-2 mb-4">
            <select
              value={photoFilter}
              onChange={e => setPhotoFilter(e.target.value)}
              className="flex-1 bg-card border border-border rounded-xl px-3 py-2 text-sm outline-none"
            >
              <option value="">All Workers</option>
              {[...new Set(photos.map(p => p.worker_email))].map(email => {
                const name = photos.find(p => p.worker_email === email)?.worker_name || email;
                return <option key={email} value={email}>{name}</option>;
              })}
            </select>
            <p className="text-xs text-muted-foreground whitespace-nowrap">{photos.filter(p => !photoFilter || p.worker_email === photoFilter).length} photos</p>
          </div>

          {photos.length === 0 ? (
            <div className="text-center py-16">
              <Camera className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">No site photos yet</p>
              <p className="text-muted-foreground/60 text-xs mt-1">Workers can upload photos from the Site Photos button on the home screen</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {photos
                .filter(p => !photoFilter || p.worker_email === photoFilter)
                .map(photo => (
                  <div key={photo.id} onClick={() => setLightboxPhoto(photo)}
                    className="bg-card border border-border rounded-2xl overflow-hidden cursor-pointer active:scale-95 transition-all">
                    <img src={photo.photo_url} alt="site" className="w-full h-36 object-cover" />
                    <div className="p-2">
                      <p className="text-xs font-semibold truncate">{photo.worker_name}</p>
                      <p className="text-xs text-muted-foreground truncate">{photo.job_name || 'No job'}</p>
                      <p className="text-[10px] text-muted-foreground/60">{photo.date}</p>
                      {photo.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate italic">"{photo.notes}"</p>}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Workers Tab */}
      {activeTab === 'Workers' && (
        <div className="px-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">{users.length} registered workers</p>
            <button onClick={() => setShowInviteModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold">
              <UserPlus className="w-4 h-4" /> Invite Worker
            </button>
          </div>
          <div className="space-y-3">
            {users.length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">No workers have logged time yet</p>
              </div>
            ) : users.map(u => (
              <div key={u.email} className="bg-card border border-border rounded-2xl p-4 flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="font-black text-primary">{u.name?.charAt(0)?.toUpperCase() || '?'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold truncate">{u.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                </div>
                <button onClick={() => { setWorkerToRemove(u); setShowRemoveModal(true); }}
                  className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center flex-shrink-0">
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite Worker Modal */}
      {showInviteModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end justify-center" onClick={() => setShowInviteModal(false)}>
          <div className="bg-card border border-border rounded-t-3xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-black">Invite Worker</h2>
              <button onClick={() => setShowInviteModal(false)} className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email Address</label>
                <input
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="worker@example.com"
                  type="email"
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Role</label>
                <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary">
                  <option value="user">Worker</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <button onClick={handleInviteWorker} disabled={inviting}
              className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-60 transition-all active:scale-95 flex items-center justify-center gap-2">
              <UserPlus className="w-4 h-4" />
              {inviting ? 'Sending Invite...' : 'Send Invite'}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* MYOB Progress Modal */}
      {myobExporting && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center px-8">
          <div className="bg-card border border-border rounded-3xl p-8 w-full max-w-sm text-center space-y-5">
            <div className="w-16 h-16 rounded-full bg-blue-500/15 border-2 border-blue-500/30 flex items-center justify-center mx-auto">
              <Loader2 className="w-7 h-7 text-blue-400 animate-spin" />
            </div>
            <div>
              <h3 className="font-black text-lg">Preparing MYOB Export</h3>
              <p className="text-muted-foreground text-sm mt-1">Formatting timesheet data for MYOB payroll import...</p>
            </div>
            <div className="w-full bg-secondary rounded-full h-3 overflow-hidden">
              <div
                className="h-full bg-blue-400 rounded-full transition-all duration-500"
                style={{ width: `${myobProgress}%` }}
              />
            </div>
            <p className="text-blue-400 font-mono font-bold text-sm">{myobProgress}%</p>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>✓ MYOB-compatible format (Co./Last Name, First Name)</p>
              <p>✓ Payroll categories & cost centres included</p>
              <p>✓ Ready for direct MYOB import</p>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Email Modal */}
      {showEmailModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end justify-center" onClick={() => setShowEmailModal(false)}>
          <div className="bg-card border border-border rounded-t-3xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-lg font-black">Email Payroll Report</h2>
                <p className="text-xs text-muted-foreground">Week of {format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d yyyy')} · {entries.length} entries · {totalHours.toFixed(2)} hrs</p>
              </div>
              <button onClick={() => setShowEmailModal(false)} className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Send to Email</label>
              <input
                value={emailAddress}
                onChange={e => setEmailAddress(e.target.value)}
                placeholder="payroll@company.com"
                type="email"
                className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl px-4 py-3 text-xs text-purple-300 space-y-1">
              <p className="font-semibold">Email will include:</p>
              <p>• Week summary (workers, total hours)</p>
              <p>• Note that CSV attachment is MYOB-ready</p>
            </div>
            <button onClick={handleEmailExport} disabled={sendingEmail}
              className="w-full py-3 rounded-2xl bg-purple-500/80 text-white font-bold text-sm disabled:opacity-60 transition-all active:scale-95 flex items-center justify-center gap-2">
              <Mail className="w-4 h-4" />
              {sendingEmail ? 'Sending...' : 'Send Payroll Report'}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Remove Worker Confirm Modal */}
      {showRemoveModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end justify-center" onClick={() => setShowRemoveModal(false)}>
          <div className="bg-card border border-border rounded-t-3xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-black">Remove Worker</h2>
              <button onClick={() => setShowRemoveModal(false)} className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to remove <span className="font-bold text-foreground">{workerToRemove?.name}</span>? This will delete all their timesheet entries.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowRemoveModal(false)}
                className="flex-1 py-3 rounded-2xl bg-secondary text-foreground font-bold text-sm">
                Cancel
              </button>
              <button onClick={handleRemoveWorker} disabled={removing}
                className="flex-1 py-3 rounded-2xl bg-destructive text-destructive-foreground font-bold text-sm disabled:opacity-60 flex items-center justify-center gap-2">
                <Trash2 className="w-4 h-4" />
                {removing ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MYOB Worker Picker Modal */}
      {showMyobPickerModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end justify-center" onClick={() => setShowMyobPickerModal(false)}>
          <div className="bg-card border border-border rounded-t-3xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-lg font-black">MYOB Export</h2>
                <p className="text-xs text-muted-foreground">Select which workers to include</p>
              </div>
              <button onClick={() => setShowMyobPickerModal(false)} className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {Object.values(workerGroups).map(worker => {
                const checked = selectedWorkerEmails.includes(worker.email);
                const workerTotal = worker.entries.reduce((sum, e) => sum + (e.total_hours || 0), 0);
                return (
                  <button key={worker.email}
                    onClick={() => setSelectedWorkerEmails(prev =>
                      checked ? prev.filter(e => e !== worker.email) : [...prev, worker.email]
                    )}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${checked ? 'bg-blue-500/10 border-blue-500/40' : 'bg-muted/30 border-border'}`}
                  >
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${checked ? 'bg-blue-500 border-blue-500' : 'border-muted-foreground/40'}`}>
                      {checked && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-black text-primary">{worker.name?.charAt(0)?.toUpperCase() || '?'}</span>
                    </div>
                    <span className="flex-1 text-left font-semibold text-sm">{worker.name}</span>
                    <span className="text-xs text-primary font-mono font-bold">{workerTotal.toFixed(2)}h</span>
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setSelectedWorkerEmails(Object.keys(workerGroups))}
                className="flex-1 py-2 rounded-xl bg-muted text-muted-foreground text-xs font-semibold">
                Select All
              </button>
              <button onClick={() => setSelectedWorkerEmails([])}
                className="flex-1 py-2 rounded-xl bg-muted text-muted-foreground text-xs font-semibold">
                Clear All
              </button>
            </div>
            <button onClick={handleMyobPickerExport} disabled={selectedWorkerEmails.length === 0}
              className="w-full py-3 rounded-2xl bg-blue-500/80 text-white font-bold text-sm disabled:opacity-40 transition-all active:scale-95 flex items-center justify-center gap-2">
              <FileText className="w-4 h-4" />
              Export {selectedWorkerEmails.length} Worker{selectedWorkerEmails.length !== 1 ? 's' : ''} to MYOB
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Edit Entry Modal */}
      {editEntry && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end justify-center" onClick={() => setEditEntry(null)}>
          <div className="bg-card border border-border rounded-t-3xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-lg font-black">Edit Entry</h2>
                <p className="text-xs text-muted-foreground">{editEntry.worker_name}</p>
              </div>
              <button onClick={() => setEditEntry(null)} className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Job Site</label>
                <select value={editForm.job_id}
                  onChange={e => setEditForm(f => ({ ...f, job_id: e.target.value }))}
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary">
                  <option value="">Select job...</option>
                  {jobs.map(j => <option key={j.id} value={j.id}>{j.job_name} #{j.job_number}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date</label>
                <input type="date" value={editForm.date}
                  onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))}
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Start Time</label>
                  <input type="time" value={editForm.start_time}
                    onChange={e => setEditForm(f => ({ ...f, start_time: e.target.value }))}
                    className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Finish Time</label>
                  <input type="time" value={editForm.finish_time}
                    onChange={e => setEditForm(f => ({ ...f, finish_time: e.target.value }))}
                    className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">🍽️ Lunch Break</label>
                <select value={editForm.lunch_break_mins}
                  onChange={e => setEditForm(f => ({ ...f, lunch_break_mins: Number(e.target.value) }))}
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary">
                  <option value={0}>No lunch break</option>
                  <option value={30}>30 minutes</option>
                  <option value={45}>45 minutes</option>
                  <option value={60}>60 minutes</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notes</label>
                <input value={editForm.notes}
                  onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional notes..."
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => handleDeleteEntry(editEntry.id)}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-destructive/15 border border-destructive/30 text-destructive font-bold text-sm transition-all active:scale-95">
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
              <button onClick={handleSaveEntry} disabled={editSaving}
                className="flex-1 py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-60 transition-all active:scale-95 flex items-center justify-center gap-2">
                <Check className="w-4 h-4" />
                {editSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Photo Lightbox */}
      {lightboxPhoto && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/90 flex flex-col items-center justify-center p-4" onClick={() => setLightboxPhoto(null)}>
          <button className="absolute top-6 right-6 w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
            <X className="w-5 h-5 text-white" />
          </button>
          <img src={lightboxPhoto.photo_url} alt="site" className="max-w-full max-h-[70vh] rounded-2xl object-contain" onClick={e => e.stopPropagation()} />
          <div className="mt-4 text-center" onClick={e => e.stopPropagation()}>
            <p className="text-white font-bold">{lightboxPhoto.worker_name}</p>
            <p className="text-white/60 text-sm">{lightboxPhoto.job_name} {lightboxPhoto.job_number ? `#${lightboxPhoto.job_number}` : ''} · {lightboxPhoto.date}</p>
            {lightboxPhoto.notes && <p className="text-white/50 text-sm mt-1 italic">"{lightboxPhoto.notes}"</p>}
            <button onClick={async () => { await base44.entities.JobPhoto.delete(lightboxPhoto.id); setLightboxPhoto(null); loadPhotos(); toast.success('Photo deleted'); }}
              className="mt-3 px-4 py-2 rounded-xl bg-destructive/80 text-white text-xs font-semibold flex items-center gap-1.5 mx-auto">
              <Trash2 className="w-3.5 h-3.5" /> Delete Photo
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Pre-Starts Tab */}
      {activeTab === 'Pre-Starts' && (
        <div className="px-6 pb-6">
          <div className="flex items-center gap-2 mb-3">
            <select
              value={preStartFilter}
              onChange={e => setPreStartFilter(e.target.value)}
              className="flex-1 bg-card border border-border rounded-xl px-3 py-2 text-sm outline-none"
            >
              <option value="">All Workers</option>
              {[...new Set(preStarts.map(p => p.worker_email))].map(email => {
                const name = preStarts.find(p => p.worker_email === email)?.worker_name || email;
                return <option key={email} value={email}>{name}</option>;
              })}
            </select>
            <p className="text-xs text-muted-foreground whitespace-nowrap">
              {preStarts.filter(p => !preStartFilter || p.worker_email === preStartFilter).length} records
            </p>
          </div>
          <div className="flex gap-2 mb-4">
            <button onClick={exportPreStartsCSV} className="flex-1 py-3 rounded-2xl bg-green-500/15 border border-green-500/30 text-green-400 font-bold flex items-center justify-center gap-2 text-sm">
              <Download className="w-4 h-4" />
              Export CSV
            </button>
            <button
              onClick={() => {
                if (preStartSelectMode) {
                  if (selectedPreStarts.length === 0) { setPreStartSelectMode(false); return; }
                  setShowPreStartEmailModal(true);
                } else {
                  setPreStartSelectMode(true);
                  setSelectedPreStarts([]);
                }
              }}
              className={`flex-1 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 text-sm border transition-all ${
                preStartSelectMode && selectedPreStarts.length > 0
                  ? 'bg-purple-500/80 border-purple-500 text-white'
                  : 'bg-purple-500/15 border-purple-500/30 text-purple-400'
              }`}>
              <Mail className="w-4 h-4" />
              {preStartSelectMode
                ? selectedPreStarts.length > 0
                  ? `Email ${selectedPreStarts.length} Selected`
                  : 'Tap records to select'
                : 'Email Report'}
            </button>
            {preStartSelectMode && (
              <button
                onClick={() => { setPreStartSelectMode(false); setSelectedPreStarts([]); }}
                className="w-12 py-3 rounded-2xl bg-secondary border border-border text-muted-foreground flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {preStarts.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-3">📋</div>
              <p className="text-muted-foreground text-sm">No pre-starts submitted yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {preStarts
                .filter(p => !preStartFilter || p.worker_email === preStartFilter)
                .map(ps => {
                  const isSelected = selectedPreStarts.includes(ps.id);
                  return (
                  <div key={ps.id} className={`bg-card border rounded-2xl overflow-hidden transition-all ${isSelected ? 'border-purple-500/60 ring-1 ring-purple-500/40' : 'border-border'}`}>
                    <button
                      onClick={() => {
                        if (preStartSelectMode) {
                          setSelectedPreStarts(prev =>
                            isSelected ? prev.filter(id => id !== ps.id) : [...prev, ps.id]
                          );
                        } else {
                          setExpandedPreStart(expandedPreStart === ps.id ? null : ps.id);
                        }
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left"
                    >
                      {preStartSelectMode ? (
                        <div className={`w-9 h-9 rounded-xl border-2 flex items-center justify-center flex-shrink-0 transition-all ${isSelected ? 'bg-purple-500 border-purple-500' : 'bg-muted border-muted-foreground/30'}`}>
                          {isSelected && <Check className="w-4 h-4 text-white" />}
                        </div>
                      ) : (
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${ps.status === 'fault' ? 'bg-red-500/15' : 'bg-green-500/15'}`}>
                          {ps.status === 'fault'
                            ? <AlertTriangle className="w-4 h-4 text-red-400" />
                            : <Check className="w-4 h-4 text-green-400" />}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm truncate">{ps.equipment_name}</p>
                        <p className="text-xs text-muted-foreground truncate">{ps.worker_name} · {ps.job_name || 'No job'}{ps.job_number ? ` #${ps.job_number}` : ''}</p>
                        <p className="text-xs text-muted-foreground/60">{ps.date}</p>
                      </div>
                      <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase flex-shrink-0 ${ps.status === 'fault' ? 'bg-red-500/15 text-red-400' : 'bg-green-500/15 text-green-400'}`}>
                        {ps.status === 'fault' ? '⚠ Fault' : '✓ Pass'}
                      </span>
                    </button>

                    {expandedPreStart === ps.id && (
                      <div className="border-t border-border px-4 py-3 space-y-2 bg-muted/30">
                        {ps.answers && Object.entries(ps.answers).map(([qId, answer]) => {
                          const isFaultAnswer = answer?.toLowerCase().includes('problem') || answer?.toLowerCase().includes('fault') || answer?.toLowerCase().includes('not working') || answer?.toLowerCase().includes('no') || answer?.toLowerCase().includes('tagged out') || answer?.toLowerCase().includes('damage') || answer?.toLowerCase().includes('do not');
                          return (
                            <div key={qId} className="flex items-start gap-2">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5 ${isFaultAnswer ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>Q{qId}</span>
                              <p className="text-xs text-muted-foreground leading-relaxed">{answer}</p>
                            </div>
                          );
                        })}
                        {ps.general_comments && (
                          <div className="mt-2 pt-2 border-t border-border">
                            <p className="text-xs font-semibold text-muted-foreground mb-1">General Comments:</p>
                            <p className="text-xs text-foreground italic">"{ps.general_comments}"</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );})}
            </div>
          )}
        </div>
      )}

      {/* Pre-Start Email Modal */}
      {showPreStartEmailModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end justify-center" onClick={() => setShowPreStartEmailModal(false)}>
          <div className="bg-card border border-border rounded-t-3xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-lg font-black">Email Pre-Start Report</h2>
                <p className="text-xs text-muted-foreground">
                  {selectedPreStarts.length > 0
                    ? `${selectedPreStarts.length} selected record${selectedPreStarts.length !== 1 ? 's' : ''}`
                    : `${preStarts.filter(p => !preStartFilter || p.worker_email === preStartFilter).length} records · All Workers`}
                </p>
              </div>
              <button onClick={() => setShowPreStartEmailModal(false)} className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Send to Email</label>
              <input
                value={preStartEmailAddress}
                onChange={e => setPreStartEmailAddress(e.target.value)}
                placeholder="manager@company.com"
                type="email"
                className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl px-4 py-3 text-xs text-purple-300 space-y-1">
              <p className="font-semibold">Email will include:</p>
              <p>• Summary: total, pass & fault counts</p>
              <p>• Every question with the worker's answer</p>
              <p>• General comments per record</p>
            </div>
            <button onClick={handlePreStartEmailExport} disabled={sendingPreStartEmail}
              className="w-full py-3 rounded-2xl bg-purple-500/80 text-white font-bold text-sm disabled:opacity-60 transition-all active:scale-95 flex items-center justify-center gap-2">
              <Mail className="w-4 h-4" />
              {sendingPreStartEmail ? 'Sending...' : 'Send Pre-Start Report'}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Job Modal */}
      {showJobModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-card border-t border-border rounded-t-3xl p-6 pb-8 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-black">{editJob ? 'Edit Job' : 'New Job Site'}</h3>
              <button onClick={() => setShowJobModal(false)} className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              {[
                { key: 'job_name', label: 'Job Name', placeholder: 'e.g. Riverside Apartments' },
                { key: 'job_number', label: 'Job Number', placeholder: 'e.g. JOB-2024-001' },
                { key: 'location_address', label: 'Address', placeholder: '123 Main St, Sydney' },
                { key: 'latitude', label: 'Latitude (GPS)', placeholder: '-33.8688' },
                { key: 'longitude', label: 'Longitude (GPS)', placeholder: '151.2093' },
                { key: 'notes', label: 'Notes', placeholder: 'Any additional info...' },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block">{label}</label>
                  <input value={jobForm[key]} onChange={e => setJobForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground outline-none placeholder:text-muted-foreground/50 text-sm" />
                </div>
              ))}
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Status</label>
                <select value={jobForm.status} onChange={e => setJobForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground outline-none">
                  <option value="active" className="bg-card">Active</option>
                  <option value="completed" className="bg-card">Completed</option>
                  <option value="on_hold" className="bg-card">On Hold</option>
                </select>
              </div>
            </div>
            <button onClick={handleSaveJob} className="w-full mt-6 py-4 rounded-2xl bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2">
              <Check className="w-5 h-5" />
              {editJob ? 'Save Changes' : 'Create Job Site'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
