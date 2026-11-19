const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ENTRY_STATUSES = new Set(['active', 'completed', 'manual']);
const PERIOD_STATUSES = new Set(['open', 'submitted', 'approved']);
const TIMESHEET_ROLES = new Set(['owner', 'admin', 'worker']);

export const COMPANY_PAY_WEEK_FIELDS = 'id,pay_week_start_day';
export const TIME_ENTRY_READ_FIELDS = [
  'id',
  'company_id',
  'worker_reference_id',
  'worker_name',
  'worker_email',
  'job_id',
  'job_name',
  'job_number',
  'date',
  'start_time',
  'finish_time',
  'lunch_break_mins',
  'total_hours',
  'status',
  'notes',
  'removed_at',
].join(',');
export const TIMESHEET_PERIOD_READ_FIELDS = [
  'id',
  'company_id',
  'worker_reference_id',
  'worker_name',
  'worker_email',
  'period_start',
  'period_end',
  'period_timezone',
  'status',
].join(',');

const invalidResponse = field => new Error(`Timesheets query returned an invalid ${field}`);

const requiredUuid = (value, field) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) throw invalidResponse(field);
  return value.trim().toLowerCase();
};

const optionalUuid = (value, field) => {
  if (value === null) return null;
  return requiredUuid(value, field);
};

const optionalText = (value, field) => {
  if (value === null) return null;
  if (typeof value !== 'string') throw invalidResponse(field);
  return value.trim() || null;
};

const requiredTimestamp = (value, field) => {
  if (typeof value !== 'string' || !value || Number.isNaN(Date.parse(value))) {
    throw invalidResponse(field);
  }
  return value;
};

const optionalTimestamp = (value, field) => {
  if (value === null) return null;
  return requiredTimestamp(value, field);
};

const numericValue = (value, field, { nullable = false } = {}) => {
  if (value === null) {
    if (nullable) return null;
    throw invalidResponse(field);
  }
  if (typeof value === 'string' && !value.trim()) throw invalidResponse(field);
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw invalidResponse(field);
  return numeric;
};

export const isTimesheetDateKey = (value) => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
};

export const addTimesheetCalendarDays = (dateKey, days) => {
  if (!isTimesheetDateKey(dateKey) || !Number.isInteger(days)) {
    throw new Error('Timesheet date and calendar-day offset are invalid');
  }
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
};

export const calculateTimesheetPayWeek = (anchorDate, payWeekStartDay) => {
  if (!isTimesheetDateKey(anchorDate) || !Number.isInteger(payWeekStartDay)
    || payWeekStartDay < 1 || payWeekStartDay > 7) {
    throw new Error('Timesheet pay-week configuration is invalid');
  }
  const [year, month, day] = anchorDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  const periodStart = addTimesheetCalendarDays(anchorDate, -((weekday - payWeekStartDay + 7) % 7));
  return { periodStart, periodEnd: addTimesheetCalendarDays(periodStart, 6) };
};

const normalizeScope = (scope) => {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error('An authenticated Timesheets workspace is required');
  }
  const userId = requiredUuid(scope.userId, 'authenticated user');
  const companyId = requiredUuid(scope.companyId, 'active company');
  if (!TIMESHEET_ROLES.has(scope.role)) throw new Error('An authorised Timesheets role is required');
  return { userId, companyId, role: scope.role };
};

export const mapTimeEntryRow = (row, expectedCompanyId, range, expectedWorkerId = null) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalidResponse('time entry');
  const companyId = requiredUuid(row.company_id, 'time entry company_id');
  const workerReferenceId = requiredUuid(row.worker_reference_id, 'worker_reference_id');
  if (
    companyId !== expectedCompanyId
    || (expectedWorkerId && workerReferenceId !== expectedWorkerId)
    || !isTimesheetDateKey(row.date)
    || row.date < range.periodStart
    || row.date > range.periodEnd
    || row.removed_at !== null
    || !TIME_ENTRY_STATUSES.has(row.status)
  ) throw new Error('Timesheets query returned an out-of-scope time entry');

  return {
    id: requiredUuid(row.id, 'time entry id'),
    company_id: companyId,
    worker_reference_id: workerReferenceId,
    worker_name: optionalText(row.worker_name, 'worker_name'),
    worker_email: optionalText(row.worker_email, 'worker_email'),
    job_id: optionalUuid(row.job_id, 'job_id'),
    job_name: optionalText(row.job_name, 'job_name'),
    job_number: optionalText(row.job_number, 'job_number'),
    date: row.date,
    start_time: requiredTimestamp(row.start_time, 'start_time'),
    finish_time: optionalTimestamp(row.finish_time, 'finish_time'),
    lunch_break_mins: numericValue(row.lunch_break_mins, 'lunch_break_mins'),
    total_hours: numericValue(row.total_hours, 'total_hours', { nullable: true }),
    status: row.status,
    notes: optionalText(row.notes, 'notes'),
    removed_at: null,
  };
};

export const mapTimesheetPeriodRow = (row, expectedCompanyId, range, expectedWorkerId = null) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalidResponse('timesheet period');
  const companyId = requiredUuid(row.company_id, 'period company_id');
  const workerReferenceId = requiredUuid(row.worker_reference_id, 'period worker_reference_id');
  if (
    companyId !== expectedCompanyId
    || (expectedWorkerId && workerReferenceId !== expectedWorkerId)
    || row.period_start !== range.periodStart
    || row.period_end !== range.periodEnd
    || !PERIOD_STATUSES.has(row.status)
    || typeof row.period_timezone !== 'string'
    || !row.period_timezone.trim()
  ) throw new Error('Timesheets query returned an out-of-scope period');

  return {
    id: requiredUuid(row.id, 'period id'),
    company_id: companyId,
    worker_reference_id: workerReferenceId,
    worker_name: optionalText(row.worker_name, 'period worker_name'),
    worker_email: optionalText(row.worker_email, 'period worker_email'),
    period_start: row.period_start,
    period_end: row.period_end,
    period_timezone: row.period_timezone.trim(),
    status: row.status,
  };
};

export const calculateStoredTimesheetHours = entries => Math.round(entries.reduce((total, entry) => (
  entry.status === 'active' || entry.total_hours === null ? total : total + entry.total_hours
), 0) * 100) / 100;

const requireResult = (result, label) => {
  if (!result || typeof result !== 'object' || !Object.hasOwn(result, 'data')) {
    throw invalidResponse(label);
  }
  if (result.error) throw result.error;
  return result.data;
};

const readCompany = async (from, companyId) => {
  const data = requireResult(await from('companies')
    .select(COMPANY_PAY_WEEK_FIELDS)
    .eq('id', companyId)
    .single(), 'company');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalidResponse('company');
  const returnedCompanyId = requiredUuid(data.id, 'company id');
  if (returnedCompanyId !== companyId || !Number.isInteger(data.pay_week_start_day)
    || data.pay_week_start_day < 1 || data.pay_week_start_day > 7) {
    throw invalidResponse('company pay week');
  }
  return data.pay_week_start_day;
};

const readRows = async (query, label) => {
  const data = requireResult(await query, label);
  if (data !== null && !Array.isArray(data)) throw invalidResponse(label);
  return data ?? [];
};

const loadTimesheets = async (from, scope, anchorDate, companyWide) => {
  const normalized = normalizeScope(scope);
  if (companyWide && normalized.role !== 'owner' && normalized.role !== 'admin') {
    throw Object.assign(new Error('Company Timesheets require Owner or Admin access'), { code: '42501' });
  }
  if (!isTimesheetDateKey(anchorDate)) throw new Error('Timesheet anchor date is invalid');

  const payWeekStartDay = await readCompany(from, normalized.companyId);
  const range = calculateTimesheetPayWeek(anchorDate, payWeekStartDay);
  let entriesQuery = from('time_entries')
    .select(TIME_ENTRY_READ_FIELDS)
    .eq('company_id', normalized.companyId)
    .gte('date', range.periodStart)
    .lte('date', range.periodEnd)
    .is('removed_at', null);
  let periodsQuery = from('timesheet_periods')
    .select(TIMESHEET_PERIOD_READ_FIELDS)
    .eq('company_id', normalized.companyId)
    .eq('period_start', range.periodStart)
    .eq('period_end', range.periodEnd);

  if (!companyWide) {
    entriesQuery = entriesQuery.eq('worker_reference_id', normalized.userId);
    periodsQuery = periodsQuery.eq('worker_reference_id', normalized.userId);
  }

  const [entryRows, periodRows] = await Promise.all([
    readRows(entriesQuery.order('date', { ascending: true }).order('start_time', { ascending: true }), 'time entries'),
    readRows(periodsQuery, 'timesheet periods'),
  ]);
  const expectedWorkerId = companyWide ? null : normalized.userId;
  const entries = entryRows.map(row => mapTimeEntryRow(row, normalized.companyId, range, expectedWorkerId));
  const periods = periodRows.map(row => mapTimesheetPeriodRow(row, normalized.companyId, range, expectedWorkerId));
  if (new Set(periods.map(period => period.worker_reference_id)).size !== periods.length) {
    throw invalidResponse('duplicate timesheet periods');
  }

  return {
    period_start: range.periodStart,
    period_end: range.periodEnd,
    period_timezone: periods[0]?.period_timezone ?? 'Australia/Sydney',
    pay_week_start_day: payWeekStartDay,
    entries,
    periods,
    total_hours: calculateStoredTimesheetHours(entries),
  };
};

export const createTimesheetsReadAdapter = (from) => {
  if (typeof from !== 'function') throw new Error('A Supabase table client is required');
  return {
    listMine(scope, anchorDate) {
      return loadTimesheets(from, scope, anchorDate, false);
    },
    listCompany(scope, anchorDate) {
      return loadTimesheets(from, scope, anchorDate, true);
    },
  };
};
