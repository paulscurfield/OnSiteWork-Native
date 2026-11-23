import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, LockKeyhole, RotateCcw, X } from 'lucide-react';
import {
  sydneyDateTimeInputValue,
  sydneyLocalDateTimeToIso,
} from '@/api/supabase/timesheets-admin-adapter';

const ACTION_COPY = {
  create: {
    title: 'Add manual Time Entry',
    description: 'Create an audited manual entry in this open pay week.',
    confirm: 'I confirm these details should be recorded as a manual Time Entry.',
    submit: 'Create manual entry',
  },
  correct: {
    title: 'Correct Time Entry',
    description: 'The existing record identity is preserved and the correction is audited.',
    confirm: 'I confirm this correction accurately reflects the work performed.',
    submit: 'Save audited correction',
  },
  recover: {
    title: 'Recover active Time Entry',
    description: 'Supply the actual finish time for this interrupted active entry.',
    confirm: 'I confirm this is the actual finish time and not an estimated convenience value.',
    submit: 'Recover active entry',
  },
  void: {
    title: 'Void Time Entry',
    description: 'This records an administrative void; it does not hard-delete the entry.',
    confirm: 'I confirm this entry is incorrect and should be voided with the reason below.',
    submit: 'Void entry',
  },
  finalise: {
    title: 'Finalise and lock pay week',
    description: 'The server will reject finalisation if an entry is still active or the period is invalid.',
    confirm: 'I have reviewed this worker’s entries and confirm this pay week should be locked.',
    submit: 'Finalise pay week',
  },
  reopen: {
    title: 'Reopen pay week',
    description: 'Reopening is audited. Export history is not available in this checkpoint, so confirm outside the app whether payroll has already been exported.',
    confirm: 'I confirm this pay week requires correction and understand it may already have been exported.',
    submit: 'Reopen pay week',
  },
};

const localNow = () => sydneyDateTimeInputValue(new Date().toISOString());
const defaultShiftStart = date => `${date}T08:00`;
const defaultShiftFinish = date => `${date}T16:30`;

const initialForm = (action, range) => {
  const entry = action.entry;
  if (action.type === 'correct') {
    return {
      workerReferenceId: entry.worker_reference_id,
      jobId: entry.job_id ?? '',
      workDate: entry.date,
      startLocal: sydneyDateTimeInputValue(entry.start_time),
      finishLocal: sydneyDateTimeInputValue(entry.finish_time),
      lunchBreakMinutes: String(entry.lunch_break_mins),
      notes: entry.notes ?? '',
      reason: '',
    };
  }
  if (action.type === 'recover') {
    return {
      finishLocal: localNow(),
      lunchBreakMinutes: String(entry.lunch_break_mins ?? 0),
      reason: '',
    };
  }
  if (action.type === 'create') {
    return {
      workerReferenceId: action.worker?.id ?? '',
      jobId: '',
      workDate: range.periodStart,
      startLocal: defaultShiftStart(range.periodStart),
      finishLocal: defaultShiftFinish(range.periodStart),
      lunchBreakMinutes: '30',
      notes: '',
      reason: '',
    };
  }
  return { reason: '' };
};

const Field = ({ label, children }) => (
  <label className="block text-xs font-bold text-muted-foreground">
    {label}
    {children}
  </label>
);

const inputClass = 'mt-1 min-h-11 w-full rounded-xl border border-border bg-muted px-3 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary';

export default function TimesheetAdminActionDialog({
  action,
  busy,
  error,
  jobs,
  onClose,
  onSubmit,
  range,
  workers,
}) {
  const [form, setForm] = useState(() => initialForm(action, range));
  const [confirmed, setConfirmed] = useState(false);
  const [localError, setLocalError] = useState('');
  const copy = ACTION_COPY[action.type];
  const activeJobs = useMemo(() => jobs.filter(job => (
    job.status === 'active' || (action.entry?.job_id && job.id === action.entry.job_id)
  )), [action.entry?.job_id, jobs]);

  const update = (field, value) => setForm(current => ({ ...current, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setLocalError('');
    if (!confirmed) {
      setLocalError('Confirm this administrative action before submitting.');
      return;
    }
    try {
      const selectedJob = activeJobs.find(job => job.id === form.jobId) ?? null;
      if (['create', 'correct'].includes(action.type) && !selectedJob) {
        throw new Error('Select an authorised Job.');
      }
      const payload = ['create', 'correct'].includes(action.type)
        ? {
            ...form,
            job: selectedJob,
            lunchBreakMinutes: Number(form.lunchBreakMinutes),
            startTime: sydneyLocalDateTimeToIso(form.startLocal),
            finishTime: sydneyLocalDateTimeToIso(form.finishLocal),
          }
        : action.type === 'recover'
          ? {
              ...form,
              lunchBreakMinutes: Number(form.lunchBreakMinutes),
              finishTime: sydneyLocalDateTimeToIso(form.finishLocal),
            }
          : form;
      await onSubmit(payload);
    } catch (submissionError) {
      setLocalError(submissionError?.message || 'Review the form and try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/70 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="timesheet-admin-action-title" onClick={busy ? undefined : onClose}>
      <form className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-border bg-card p-6 sm:rounded-3xl" onSubmit={submit} onClick={event => event.stopPropagation()}>
        <header className="flex items-start gap-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-primary/10">
            {action.type === 'reopen' ? <RotateCcw className="h-5 w-5 text-primary" /> : action.type === 'finalise' ? <LockKeyhole className="h-5 w-5 text-primary" /> : <Clock3 className="h-5 w-5 text-primary" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="timesheet-admin-action-title" className="text-xl font-black">{copy.title}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{copy.description}</p>
          </div>
          <button type="button" disabled={busy} onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary disabled:opacity-50" aria-label="Close Timesheet action"><X className="h-4 w-4" /></button>
        </header>

        <div className="mt-5 rounded-2xl border border-border bg-secondary/30 p-4 text-sm">
          <p className="font-black">{action.worker?.name ?? 'Selected worker'}</p>
          <p className="mt-1 text-xs text-muted-foreground">Pay week {range.periodStart} to {range.periodEnd}</p>
          {action.summary && <p className="mt-1 text-xs text-muted-foreground">{action.summary.totalHours.toFixed(2)} recorded hours · {action.summary.status === 'approved' ? 'Locked' : action.summary.status === 'submitted' ? 'Historical review required' : 'Open'}</p>}
        </div>

        {action.type === 'create' && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Worker">
              <select required value={form.workerReferenceId} onChange={event => update('workerReferenceId', event.target.value)} className={inputClass}>
                <option value="">Select worker</option>
                {workers.map(worker => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
              </select>
            </Field>
            <Field label="Active Job">
              <select required value={form.jobId} onChange={event => update('jobId', event.target.value)} className={inputClass}>
                <option value="">Select Job</option>
                {activeJobs.filter(job => job.status === 'active').map(job => <option key={job.id} value={job.id}>{job.job_name} · #{job.job_number}</option>)}
              </select>
            </Field>
          </div>
        )}

        {action.type === 'correct' && (
          <div className="mt-5">
            <Field label="Job">
              <select required value={form.jobId} onChange={event => update('jobId', event.target.value)} className={inputClass}>
                {activeJobs.map(job => <option key={job.id} value={job.id}>{job.job_name} · #{job.job_number}{job.status === 'active' ? '' : ' · existing inactive Job'}</option>)}
              </select>
            </Field>
          </div>
        )}

        {['create', 'correct'].includes(action.type) && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Work date">
              <input required type="date" min={range.periodStart} max={range.periodEnd} value={form.workDate} onChange={event => update('workDate', event.target.value)} className={inputClass} />
            </Field>
            <Field label="Unpaid break (minutes)">
              <input required type="number" min="0" step="1" value={form.lunchBreakMinutes} onChange={event => update('lunchBreakMinutes', event.target.value)} className={inputClass} />
            </Field>
            <Field label="Start · Australia/Sydney">
              <input required type="datetime-local" value={form.startLocal} onChange={event => update('startLocal', event.target.value)} className={inputClass} />
            </Field>
            <Field label="Finish · Australia/Sydney">
              <input required type="datetime-local" value={form.finishLocal} onChange={event => update('finishLocal', event.target.value)} className={inputClass} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Notes (optional)">
                <textarea rows={3} value={form.notes} onChange={event => update('notes', event.target.value)} className={`${inputClass} py-3`} />
              </Field>
            </div>
          </div>
        )}

        {action.type === 'recover' && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Actual finish · Australia/Sydney">
              <input required type="datetime-local" value={form.finishLocal} onChange={event => update('finishLocal', event.target.value)} className={inputClass} />
            </Field>
            <Field label="Unpaid break (minutes)">
              <input required type="number" min="0" step="1" value={form.lunchBreakMinutes} onChange={event => update('lunchBreakMinutes', event.target.value)} className={inputClass} />
            </Field>
          </div>
        )}

        {['create', 'correct', 'recover', 'void', 'reopen'].includes(action.type) && (
          <div className="mt-4">
            <Field label={action.type === 'void' ? 'Void reason' : action.type === 'reopen' ? 'Reopen reason' : action.type === 'recover' ? 'Recovery reason' : 'Correction reason'}>
              <textarea required rows={3} value={form.reason} onChange={event => update('reason', event.target.value)} className={`${inputClass} py-3`} />
            </Field>
          </div>
        )}

        {(localError || error) && (
          <div className="mt-4 flex gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
            <p>{localError || error}</p>
          </div>
        )}

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-secondary/30 p-4 text-sm leading-6">
          <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4" />
          <span>{copy.confirm}</span>
        </label>

        <button type="submit" disabled={busy || !confirmed} className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-black text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
          <CheckCircle2 className="h-4 w-4" />
          {busy ? 'Submitting once…' : copy.submit}
        </button>
      </form>
    </div>
  );
}
