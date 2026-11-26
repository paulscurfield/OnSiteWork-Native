const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const LOCAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const DECIMAL_HOURS_PATTERN = /^(?:0|[1-9]\d*)\.\d{2}$/u;
const SNAPSHOT_HASH_PATTERN = /^[0-9a-f]{64}$/u;

const NO_DATA_KEYS = ['period_end', 'period_start', 'period_timezone', 'state'];
const READY_KEYS = [
  'created_at',
  'export_id',
  'locked_period_ids',
  'period_end',
  'period_start',
  'period_timezone',
  'request_id',
  'row_count',
  'rows',
  'snapshot_hash',
  'state',
  'total_hours',
  'version',
  'worker_count',
];
const ROW_KEYS = [
  'entry_id',
  'entry_status',
  'finish_time_local',
  'finish_time_utc',
  'job_id',
  'job_name',
  'job_number',
  'locked_at_utc',
  'lunch_break_minutes',
  'period_id',
  'period_timezone',
  'start_time_local',
  'start_time_utc',
  'total_hours',
  'work_date',
  'worker_email',
  'worker_name',
  'worker_reference_id',
  'worker_week_total_hours',
];
const PARSED_RESPONSES = new WeakSet();

const invalidResponse = () => new Error('Payroll export response was invalid');

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value, expectedKeys) => {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
};

const isUuid = value => typeof value === 'string' && UUID_PATTERN.test(value);

const isDateKey = value => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const addUtcDays = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const isTimestamp = value => typeof value === 'string'
  && TIMESTAMP_PATTERN.test(value)
  && isDateKey(value.slice(0, 10))
  && !Number.isNaN(Date.parse(value));

const isUtcTimestamp = value => typeof value === 'string'
  && UTC_TIMESTAMP_PATTERN.test(value)
  && isDateKey(value.slice(0, 10))
  && !Number.isNaN(Date.parse(value));

const isLocalTimestamp = value => {
  if (typeof value !== 'string' || !LOCAL_TIMESTAMP_PATTERN.test(value)) return false;
  const [datePart, timePart] = value.split('T');
  const [hour, minute, secondWithFraction] = timePart.split(':');
  const second = Number(secondWithFraction.split('.')[0]);
  return isDateKey(datePart)
    && Number(hour) >= 0
    && Number(hour) <= 23
    && Number(minute) >= 0
    && Number(minute) <= 59
    && second >= 0
    && second <= 59;
};

const isTimezone = value => {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) return false;
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
};

const isNullableText = value => value === null || typeof value === 'string';
const isNullableUuid = value => value === null || isUuid(value);

export const hoursToHundredths = value => {
  if (typeof value !== 'string' || !DECIMAL_HOURS_PATTERN.test(value)) {
    throw invalidResponse();
  }

  const [whole, fraction] = value.split('.');
  const hundredths = (BigInt(whole) * 100n) + BigInt(fraction);
  if (hundredths > BigInt(Number.MAX_SAFE_INTEGER)) throw invalidResponse();
  return Number(hundredths);
};

export const hundredthsToHours = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw invalidResponse();
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
};

export const isParsedPayrollExportResponse = value => (
  isRecord(value) && PARSED_RESPONSES.has(value)
);

const safeAdd = (left, right) => {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw invalidResponse();
  return result;
};

const freezeRow = row => Object.freeze(row);

const parseRow = (value, context) => {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ROW_KEYS)
    || !isUuid(value.entry_id)
    || !isUuid(value.worker_reference_id)
    || !isNullableText(value.worker_name)
    || !isNullableText(value.worker_email)
    || !isUuid(value.period_id)
    || !context.lockedPeriodIds.has(value.period_id)
    || !isUtcTimestamp(value.locked_at_utc)
    || !isDateKey(value.work_date)
    || value.work_date < context.periodStart
    || value.work_date > context.periodEnd
    || !isUtcTimestamp(value.start_time_utc)
    || !isUtcTimestamp(value.finish_time_utc)
    || !isLocalTimestamp(value.start_time_local)
    || !isLocalTimestamp(value.finish_time_local)
    || value.period_timezone !== context.periodTimezone
    || !Number.isSafeInteger(value.lunch_break_minutes)
    || value.lunch_break_minutes < 0
    || (value.entry_status !== 'completed' && value.entry_status !== 'manual')
    || !isNullableUuid(value.job_id)
    || !isNullableText(value.job_number)
    || !isNullableText(value.job_name)
  ) {
    throw invalidResponse();
  }

  const totalHoursHundredths = hoursToHundredths(value.total_hours);
  const workerWeekTotalHoursHundredths = hoursToHundredths(value.worker_week_total_hours);

  return freezeRow({
    entryId: value.entry_id,
    workerReferenceId: value.worker_reference_id,
    workerName: value.worker_name,
    workerEmail: value.worker_email,
    periodId: value.period_id,
    lockedAtUtc: value.locked_at_utc,
    workDate: value.work_date,
    startTimeUtc: value.start_time_utc,
    finishTimeUtc: value.finish_time_utc,
    startTimeLocal: value.start_time_local,
    finishTimeLocal: value.finish_time_local,
    periodTimezone: value.period_timezone,
    lunchBreakMinutes: value.lunch_break_minutes,
    totalHours: value.total_hours,
    totalHoursHundredths,
    workerWeekTotalHours: value.worker_week_total_hours,
    workerWeekTotalHoursHundredths,
    entryStatus: value.entry_status,
    jobId: value.job_id,
    jobNumber: value.job_number,
    jobName: value.job_name,
  });
};

const assertReconciled = (rows, value, lockedPeriodIds) => {
  const entryIds = new Set();
  const rowPeriodIds = new Set();
  const workers = new Map();
  const jobs = new Map();
  let rowTotal = 0;
  let jobTotal = 0;

  for (const row of rows) {
    if (entryIds.has(row.entryId)) throw invalidResponse();
    entryIds.add(row.entryId);
    rowPeriodIds.add(row.periodId);

    const worker = workers.get(row.workerReferenceId);
    if (worker) {
      if (
        worker.name !== row.workerName
        || worker.email !== row.workerEmail
        || worker.reportedTotal !== row.workerWeekTotalHoursHundredths
      ) {
        throw invalidResponse();
      }
      worker.rowTotal = safeAdd(worker.rowTotal, row.totalHoursHundredths);
    } else {
      workers.set(row.workerReferenceId, {
        name: row.workerName,
        email: row.workerEmail,
        reportedTotal: row.workerWeekTotalHoursHundredths,
        rowTotal: row.totalHoursHundredths,
      });
    }

    if (row.jobId !== null) {
      const job = jobs.get(row.jobId);
      if (job && (job.number !== row.jobNumber || job.name !== row.jobName)) {
        throw invalidResponse();
      }
      if (!job) jobs.set(row.jobId, { number: row.jobNumber, name: row.jobName });
    }

    rowTotal = safeAdd(rowTotal, row.totalHoursHundredths);
    jobTotal = safeAdd(jobTotal, row.totalHoursHundredths);
  }

  if (
    workers.size !== value.worker_count
    || rows.length !== value.row_count
    || rowPeriodIds.size !== lockedPeriodIds.size
    || ![...lockedPeriodIds].every(periodId => rowPeriodIds.has(periodId))
  ) {
    throw invalidResponse();
  }

  let workerTotal = 0;
  for (const worker of workers.values()) {
    if (worker.rowTotal !== worker.reportedTotal) throw invalidResponse();
    workerTotal = safeAdd(workerTotal, worker.reportedTotal);
  }

  const declaredTotal = hoursToHundredths(value.total_hours);
  if (workerTotal !== declaredTotal || rowTotal !== declaredTotal || jobTotal !== declaredTotal) {
    throw invalidResponse();
  }
};

export function parsePayrollExportResponse(value, expectedRequestId) {
  if (!isRecord(value) || (value.state !== 'ready' && value.state !== 'no_data')) {
    throw invalidResponse();
  }

  if (
    !isDateKey(value.period_start)
    || !isDateKey(value.period_end)
    || value.period_end !== addUtcDays(value.period_start, 6)
    || !isTimezone(value.period_timezone)
  ) {
    throw invalidResponse();
  }

  if (value.state === 'no_data') {
    if (!hasExactKeys(value, NO_DATA_KEYS)) throw invalidResponse();
    const response = Object.freeze({
      state: 'no_data',
      periodStart: value.period_start,
      periodEnd: value.period_end,
      periodTimezone: value.period_timezone,
    });
    PARSED_RESPONSES.add(response);
    return response;
  }

  if (
    !hasExactKeys(value, READY_KEYS)
    || !isUuid(value.export_id)
    || !isUuid(value.request_id)
    || (expectedRequestId !== undefined && value.request_id !== expectedRequestId)
    || !Number.isSafeInteger(value.version)
    || value.version <= 0
    || !isTimestamp(value.created_at)
    || !Number.isSafeInteger(value.worker_count)
    || value.worker_count <= 0
    || !Number.isSafeInteger(value.row_count)
    || value.row_count <= 0
    || !Array.isArray(value.locked_period_ids)
    || value.locked_period_ids.length === 0
    || !value.locked_period_ids.every(isUuid)
    || new Set(value.locked_period_ids).size !== value.locked_period_ids.length
    || typeof value.snapshot_hash !== 'string'
    || !SNAPSHOT_HASH_PATTERN.test(value.snapshot_hash)
    || !Array.isArray(value.rows)
    || value.rows.length !== value.row_count
  ) {
    throw invalidResponse();
  }

  const lockedPeriodIds = new Set(value.locked_period_ids);
  const context = {
    periodStart: value.period_start,
    periodEnd: value.period_end,
    periodTimezone: value.period_timezone,
    lockedPeriodIds,
  };
  const rows = Object.freeze(value.rows.map(row => parseRow(row, context)));
  assertReconciled(rows, value, lockedPeriodIds);

  const response = Object.freeze({
    state: 'ready',
    exportId: value.export_id,
    requestId: value.request_id,
    version: value.version,
    periodStart: value.period_start,
    periodEnd: value.period_end,
    periodTimezone: value.period_timezone,
    createdAt: value.created_at,
    workerCount: value.worker_count,
    rowCount: value.row_count,
    totalHours: value.total_hours,
    totalHoursHundredths: hoursToHundredths(value.total_hours),
    lockedPeriodIds: Object.freeze([...value.locked_period_ids]),
    snapshotHash: value.snapshot_hash,
    rows,
  });
  PARSED_RESPONSES.add(response);
  return response;
}
