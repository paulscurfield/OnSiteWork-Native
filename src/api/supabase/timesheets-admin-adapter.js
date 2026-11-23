const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ADMIN_ROLES = new Set(['owner', 'admin']);
const EDITABLE_ENTRY_STATUSES = new Set(['completed', 'manual']);
const PERIOD_STATUSES = new Set(['open', 'submitted', 'approved']);
const PERIOD_TIME_ZONE = 'Australia/Sydney';

const invalidInput = message => Object.assign(new Error(message), { code: '22023' });
const permissionDenied = message => Object.assign(new Error(message), { code: '42501' });
const duplicateSubmission = () => Object.assign(
  new Error('This Timesheet action is already being submitted.'),
  { code: '409' },
);

const requiredUuid = (value, field) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw invalidInput(`${field} must be a Supabase UUID.`);
  }
  return value.trim().toLowerCase();
};

const requiredDate = (value, field) => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw invalidInput(`${field} must be a calendar date.`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) throw invalidInput(`${field} must be a valid calendar date.`);
  return value;
};

const requiredTimestamp = (value, field) => {
  if (typeof value !== 'string' || !value || Number.isNaN(Date.parse(value))) {
    throw invalidInput(`${field} must be a timestamp.`);
  }
  return value;
};

const requiredBreakMinutes = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw invalidInput('Break minutes must be zero or a positive number.');
  }
  return value;
};

const optionalNotes = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw invalidInput('Notes must be text.');
  return value;
};

const requiredReason = (value, label = 'Audit reason') => {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidInput(`${label} is required.`);
  }
  return value.trim();
};

const numericValue = (value, field, { integer = false, positive = false } = {}) => {
  if (typeof value === 'string' && !value.trim()) throw new Error(`Timesheet RPC returned invalid ${field}.`);
  const parsed = typeof value === 'number' ? value : Number(value);
  if (
    !Number.isFinite(parsed)
    || parsed < 0
    || (integer && !Number.isInteger(parsed))
    || (positive && parsed < 1)
  ) throw new Error(`Timesheet RPC returned invalid ${field}.`);
  return parsed;
};

const sydneyDate = (timestamp) => {
  const parts = new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: PERIOD_TIME_ZONE,
    year: 'numeric',
  }).formatToParts(new Date(timestamp));
  const part = type => parts.find(candidate => candidate.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

const validateShift = ({ workDate, startTime, finishTime, lunchBreakMinutes }) => {
  const date = requiredDate(workDate, 'Work date');
  const start = requiredTimestamp(startTime, 'Start time');
  const finish = requiredTimestamp(finishTime, 'Finish time');
  const breakMinutes = requiredBreakMinutes(lunchBreakMinutes);
  const startMillis = Date.parse(start);
  const finishMillis = Date.parse(finish);
  const elapsedMinutes = (finishMillis - startMillis) / 60000;

  if (finishMillis <= startMillis) {
    throw invalidInput('Finish time must be after start time.');
  }
  if (elapsedMinutes > 1440) {
    throw invalidInput('Elapsed shift duration cannot exceed 24 hours.');
  }
  if (breakMinutes > elapsedMinutes) {
    throw invalidInput('Break cannot exceed the elapsed shift duration.');
  }
  if (finishMillis > Date.now() + (15 * 60 * 1000)) {
    throw invalidInput('Finish time is outside the permitted future tolerance.');
  }
  if (sydneyDate(start) !== date) {
    throw invalidInput('Work date must match the Australia/Sydney date of the shift start.');
  }

  return { workDate: date, startTime: start, finishTime: finish, lunchBreakMinutes: breakMinutes };
};

const normalizeScope = (scope) => {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw permissionDenied('An authenticated active Timesheets workspace is required.');
  }
  if (
    typeof scope.userId !== 'string'
    || !UUID_PATTERN.test(scope.userId.trim())
    || typeof scope.companyId !== 'string'
    || !UUID_PATTERN.test(scope.companyId.trim())
  ) throw permissionDenied('An authenticated active Timesheets workspace is required.');
  const userId = requiredUuid(scope.userId, 'Authenticated user');
  const companyId = requiredUuid(scope.companyId, 'Active company');
  if (!ADMIN_ROLES.has(scope.role)) {
    throw permissionDenied('Owner or Admin Timesheet access is required.');
  }
  return { userId, companyId, role: scope.role };
};

const authenticatedUserId = (result) => {
  if (!result || typeof result !== 'object' || result.error) {
    if (result?.error) throw result.error;
    throw permissionDenied('Authentication could not be confirmed.');
  }
  const user = result.data?.user;
  if (!user) throw permissionDenied('Authentication is required.');
  return requiredUuid(user.id, 'Authenticated user');
};

const validatePeriodRange = (range) => {
  if (!range || typeof range !== 'object' || Array.isArray(range)) {
    throw invalidInput('A Timesheet pay week is required.');
  }
  const periodStart = requiredDate(range.periodStart, 'Period start');
  const periodEnd = requiredDate(range.periodEnd, 'Period end');
  if (periodEnd < periodStart) throw invalidInput('Timesheet period is invalid.');
  return { periodStart, periodEnd };
};

const validateEntryTarget = (scope, entry, range, allowedStatuses) => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw invalidInput('A current Time Entry is required.');
  }
  const id = requiredUuid(entry.id, 'Time Entry');
  const companyId = requiredUuid(entry.company_id, 'Time Entry company');
  const workerReferenceId = requiredUuid(entry.worker_reference_id, 'Time Entry worker');
  const date = requiredDate(entry.date, 'Time Entry date');
  const period = validatePeriodRange(range);
  if (companyId !== scope.companyId || date < period.periodStart || date > period.periodEnd) {
    throw permissionDenied('The Time Entry is outside the active company or pay week.');
  }
  if (!allowedStatuses.has(entry.status) || entry.removed_at !== null) {
    throw invalidInput('The Time Entry is not in a state supported by this action.');
  }
  if (entry.periodStatus !== 'open') {
    throw permissionDenied('This Timesheet period is not open for changes.');
  }
  return { id, companyId, workerReferenceId, date, status: entry.status, period };
};

const parseTimeEntry = (data, expected) => {
  const entry = data && typeof data === 'object' && !Array.isArray(data) ? data.time_entry : null;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error('Admin Time Entry response was invalid.');
  }
  const result = {
    id: requiredUuid(entry.id, 'Returned Time Entry'),
    companyId: requiredUuid(entry.company_id, 'Returned Time Entry company'),
    workerReferenceId: requiredUuid(entry.worker_reference_id, 'Returned Time Entry worker'),
    jobId: requiredUuid(entry.job_id, 'Returned Time Entry Job'),
    date: requiredDate(entry.date, 'Returned Time Entry date'),
    startTime: requiredTimestamp(entry.start_time, 'Returned start time'),
    finishTime: requiredTimestamp(entry.finish_time, 'Returned finish time'),
    lunchBreakMinutes: numericValue(entry.lunch_break_mins, 'break minutes'),
    totalHours: numericValue(entry.total_hours, 'stored total hours'),
    status: entry.status,
    removedAt: entry.removed_at,
  };
  if (
    result.companyId !== expected.companyId
    || result.workerReferenceId !== expected.workerReferenceId
    || result.jobId !== expected.jobId
    || result.date !== expected.date
    || (expected.id && result.id !== expected.id)
    || !expected.statuses.has(result.status)
    || result.removedAt !== null
  ) throw new Error('Admin Time Entry response crossed the requested scope.');
  return result;
};

const parsePeriod = (data, expected, { finalised = false } = {}) => {
  const period = data && typeof data === 'object' && !Array.isArray(data) ? data.timesheet_period : null;
  if (!period || typeof period !== 'object' || Array.isArray(period)) {
    throw new Error('Admin Timesheet period response was invalid.');
  }
  const status = period.status;
  if (!PERIOD_STATUSES.has(status)) throw new Error('Admin Timesheet period response was invalid.');
  const result = {
    id: requiredUuid(period.id, 'Returned Timesheet period'),
    companyId: requiredUuid(period.company_id, 'Returned period company'),
    workerReferenceId: requiredUuid(period.worker_reference_id, 'Returned period worker'),
    periodStart: requiredDate(period.period_start, 'Returned period start'),
    periodEnd: requiredDate(period.period_end, 'Returned period end'),
    periodTimezone: period.period_timezone,
    status,
  };
  if (
    result.companyId !== expected.companyId
    || result.workerReferenceId !== expected.workerReferenceId
    || result.periodStart !== expected.periodStart
    || result.periodEnd !== expected.periodEnd
    || result.periodTimezone !== PERIOD_TIME_ZONE
    || result.status !== expected.status
    || (expected.id && result.id !== expected.id)
  ) throw new Error('Admin Timesheet period response crossed the requested scope.');

  if (finalised) {
    result.entryCount = numericValue(data.entry_count, 'entry count', { integer: true, positive: true });
    result.totalLockedHours = numericValue(data.total_locked_hours, 'locked hours');
  }
  return result;
};

const rpcResult = async (rpc, name, params) => {
  const response = await rpc(name, params);
  if (!response || typeof response !== 'object') throw new Error(`${name} returned an invalid response envelope.`);
  if (response.error) throw response.error;
  return response.data;
};

export const sydneyDateTimeInputValue = (timestamp) => {
  if (!timestamp) return '';
  requiredTimestamp(timestamp, 'Timestamp');
  const parts = new Intl.DateTimeFormat('en-AU', {
    day: '2-digit', hour: '2-digit', hourCycle: 'h23', minute: '2-digit', month: '2-digit',
    timeZone: PERIOD_TIME_ZONE, year: 'numeric',
  }).formatToParts(new Date(timestamp));
  const part = type => parts.find(candidate => candidate.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
};

export const sydneyLocalDateTimeToIso = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw invalidInput('Date and time must use the expected format.');
  }
  const [datePart, timePart] = value.split('T');
  requiredDate(datePart, 'Local date');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  if (hour > 23 || minute > 59) throw invalidInput('Local time is invalid.');

  const target = `${datePart}T${timePart}`;
  const approximate = Date.UTC(year, month - 1, day, hour, minute);
  const matches = [];
  for (let candidate = approximate - (14 * 60 * 60 * 1000); candidate <= approximate - (8 * 60 * 60 * 1000); candidate += 60000) {
    if (sydneyDateTimeInputValue(new Date(candidate).toISOString()) === target) matches.push(candidate);
  }
  if (!matches.length) throw invalidInput('This Australia/Sydney local time does not exist.');
  return new Date(matches[0]).toISOString();
};

export const timesheetAdminErrorMessage = (error) => {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (error?.code === '409') return 'This action is already being submitted.';
  if (error?.code === '28000' || error?.code === '42501') {
    if (/period is not open/i.test(message)) return 'This pay week is locked. Reopen it before changing entries.';
    return 'Your current workspace no longer permits this Timesheet action.';
  }
  if (error?.code === '40001') return 'This record changed. Refresh the pay week before trying again.';
  if (/Active Time Entries must be finished/i.test(message)) return 'Finish or recover the active entry before finalising this pay week.';
  if (/At least one Time Entry is required/i.test(message)) return 'Add at least one Time Entry before finalising this pay week.';
  if (/submitted timesheet period/i.test(message)) return 'Reopen this historical submitted period before finalising it.';
  if (/active Time Entry is required/i.test(message)) return 'This entry is no longer active. Refresh the pay week before continuing.';
  if (/completed or manual Time Entry/i.test(message)) return 'Only an available completed or manual entry can be changed.';
  if (['22023', '23502', '23503', '23514'].includes(error?.code)) return message || 'Review the Timesheet values and try again.';
  if (/response (was invalid|crossed)/i.test(message)) return 'Supabase returned an unexpected Timesheet response. No local payroll state was changed.';
  return 'The outcome could not be confirmed. Refresh the pay week before deciding whether to try again.';
};

export const createTimesheetsAdminAdapter = (getUser, rpc) => {
  if (typeof getUser !== 'function' || typeof rpc !== 'function') {
    throw new Error('Supabase authentication and RPC clients are required.');
  }
  const inFlight = new Set();

  const run = async (scopeInput, mutationKey, operation) => {
    const scope = normalizeScope(scopeInput);
    const key = `${scope.userId}:${scope.companyId}:${scope.role}:${mutationKey}`;
    if (inFlight.has(key)) throw duplicateSubmission();
    inFlight.add(key);
    try {
      const userId = authenticatedUserId(await getUser());
      if (userId !== scope.userId) throw permissionDenied('Authenticated identity changed before submission.');
      return await operation(scope);
    } finally {
      inFlight.delete(key);
    }
  };

  return {
    createManual(scopeInput, input) {
      return run(scopeInput, `create:${input?.workerReferenceId ?? ''}:${input?.workDate ?? ''}`, async (scope) => {
        const companyId = requiredUuid(input?.companyId, 'Company');
        const workerReferenceId = requiredUuid(input?.workerReferenceId, 'Worker');
        const jobId = requiredUuid(input?.job?.id, 'Job');
        if (companyId !== scope.companyId || requiredUuid(input?.job?.company_id, 'Job company') !== scope.companyId) {
          throw permissionDenied('The worker or Job is outside the active company.');
        }
        if (input.job.status !== 'active') throw invalidInput('A manual entry requires an active Job.');
        const shift = validateShift(input);
        const range = validatePeriodRange(input?.range);
        if (shift.workDate < range.periodStart || shift.workDate > range.periodEnd) {
          throw invalidInput('The manual entry work date must remain in the selected pay week.');
        }
        if (input?.periodStatus !== 'open') {
          throw permissionDenied('This Timesheet period is not open for changes.');
        }
        const reason = requiredReason(input.reason, 'Correction reason');
        const data = await rpcResult(rpc, 'create_open_manual_time_entry_admin', {
          p_company_id: scope.companyId,
          p_worker_reference_id: workerReferenceId,
          p_job_id: jobId,
          p_date: shift.workDate,
          p_start_time: shift.startTime,
          p_finish_time: shift.finishTime,
          p_lunch_break_mins: shift.lunchBreakMinutes,
          p_notes: optionalNotes(input.notes),
          p_reason: reason,
        });
        return parseTimeEntry(data, {
          companyId: scope.companyId, workerReferenceId, jobId, date: shift.workDate,
          statuses: new Set(['manual']),
        });
      });
    },

    correct(scopeInput, input) {
      return run(scopeInput, `correct:${input?.entry?.id ?? ''}`, async (scope) => {
        const target = validateEntryTarget(scope, input?.entry, input?.range, EDITABLE_ENTRY_STATUSES);
        const jobId = requiredUuid(input?.job?.id, 'Job');
        if (requiredUuid(input?.job?.company_id, 'Job company') !== scope.companyId) {
          throw permissionDenied('The selected Job is outside the active company.');
        }
        if (jobId !== input.entry.job_id && input.job.status !== 'active') {
          throw invalidInput('A changed Job must be active.');
        }
        const shift = validateShift(input);
        if (shift.workDate < target.period.periodStart || shift.workDate > target.period.periodEnd) {
          throw invalidInput('The corrected work date must remain in the same pay week.');
        }
        const reason = requiredReason(input.reason, 'Correction reason');
        const data = await rpcResult(rpc, 'correct_open_time_entry_admin', {
          p_time_entry_id: target.id,
          p_job_id: jobId,
          p_date: shift.workDate,
          p_start_time: shift.startTime,
          p_finish_time: shift.finishTime,
          p_lunch_break_mins: shift.lunchBreakMinutes,
          p_notes: optionalNotes(input.notes),
          p_reason: reason,
        });
        return parseTimeEntry(data, {
          id: target.id, companyId: scope.companyId, workerReferenceId: target.workerReferenceId,
          jobId, date: shift.workDate, statuses: EDITABLE_ENTRY_STATUSES,
        });
      });
    },

    recover(scopeInput, input) {
      return run(scopeInput, `recover:${input?.entry?.id ?? ''}`, async (scope) => {
        const target = validateEntryTarget(scope, input?.entry, input?.range, new Set(['active']));
        const finishTime = requiredTimestamp(input?.finishTime, 'Finish time');
        const lunchBreakMinutes = requiredBreakMinutes(input?.lunchBreakMinutes);
        const reason = requiredReason(input?.reason, 'Recovery reason');
        const elapsedMinutes = (Date.parse(finishTime) - Date.parse(requiredTimestamp(input.entry.start_time, 'Start time'))) / 60000;
        if (elapsedMinutes <= 0 || elapsedMinutes > 1440 || lunchBreakMinutes > elapsedMinutes) {
          throw invalidInput('Recovery finish time or break is outside the permitted shift duration.');
        }
        if (Date.parse(finishTime) > Date.now() + (15 * 60 * 1000)) {
          throw invalidInput('Finish time is outside the permitted future tolerance.');
        }
        const data = await rpcResult(rpc, 'recover_active_time_entry_admin', {
          p_time_entry_id: target.id,
          p_finish_time: finishTime,
          p_lunch_break_mins: lunchBreakMinutes,
          p_reason: reason,
        });
        return parseTimeEntry(data, {
          id: target.id,
          companyId: scope.companyId,
          workerReferenceId: target.workerReferenceId,
          jobId: requiredUuid(input.entry.job_id, 'Time Entry Job'),
          date: target.date,
          statuses: new Set(['completed']),
        });
      });
    },

    void(scopeInput, input) {
      return run(scopeInput, `void:${input?.entry?.id ?? ''}`, async (scope) => {
        const target = validateEntryTarget(scope, input?.entry, input?.range, EDITABLE_ENTRY_STATUSES);
        const reason = requiredReason(input?.reason, 'Void reason');
        const data = await rpcResult(rpc, 'void_open_time_entry_admin', {
          p_time_entry_id: target.id,
          p_reason: reason,
        });
        if (!data || typeof data !== 'object' || data.removed !== true || data.id !== target.id) {
          throw new Error('Void Time Entry response was invalid.');
        }
        return { id: target.id, removed: true };
      });
    },

    finalise(scopeInput, input) {
      return run(scopeInput, `finalise:${input?.workerReferenceId ?? ''}:${input?.range?.periodStart ?? ''}`, async (scope) => {
        const workerReferenceId = requiredUuid(input?.workerReferenceId, 'Worker');
        const range = validatePeriodRange(input?.range);
        if (input?.periodStatus === 'submitted') {
          throw invalidInput('A historical submitted period must be reopened before finalisation.');
        }
        if (!['open', 'approved'].includes(input?.periodStatus)) throw invalidInput('Timesheet period state is invalid.');
        if (!Number.isInteger(input?.entryCount) || input.entryCount < 1) {
          throw invalidInput('At least one Time Entry is required for finalisation.');
        }
        if (input?.hasActiveEntries) throw invalidInput('Active Time Entries must be finished before finalisation.');
        const data = await rpcResult(rpc, 'finalise_timesheet_period_admin', {
          p_worker_reference_id: workerReferenceId,
          p_period_date: range.periodStart,
        });
        return parsePeriod(data, {
          companyId: scope.companyId, workerReferenceId, ...range, status: 'approved',
        }, { finalised: true });
      });
    },

    reopen(scopeInput, input) {
      return run(scopeInput, `reopen:${input?.period?.id ?? ''}`, async (scope) => {
        const range = validatePeriodRange(input?.range);
        const period = input?.period;
        if (!period || typeof period !== 'object' || Array.isArray(period)) {
          throw invalidInput('A current Timesheet period is required.');
        }
        const id = requiredUuid(period.id, 'Timesheet period');
        const companyId = requiredUuid(period.company_id, 'Timesheet period company');
        const workerReferenceId = requiredUuid(period.worker_reference_id, 'Timesheet period worker');
        if (
          companyId !== scope.companyId
          || period.period_start !== range.periodStart
          || period.period_end !== range.periodEnd
          || !['approved', 'submitted'].includes(period.status)
        ) throw permissionDenied('The Timesheet period is outside the active workspace or cannot be reopened.');
        const reason = requiredReason(input?.reason, 'Reopen reason');
        const data = await rpcResult(rpc, 'reopen_timesheet_period_admin', {
          p_timesheet_period_id: id,
          p_reason: reason,
        });
        return parsePeriod(data, {
          id, companyId: scope.companyId, workerReferenceId, ...range, status: 'open',
        });
      });
    },
  };
};
