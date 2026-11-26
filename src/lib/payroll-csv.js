import {
  hundredthsToHours,
  isParsedPayrollExportResponse,
} from './payroll-export-contract.js';

const CSV_BOM = '\uFEFF';
const CRLF = '\r\n';
const FORMULA_OR_LEADING_CONTROL_PATTERN = /^(?:[=+\-@]|\s|[\u0000-\u001f\u007f-\u009f])/u;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const UNASSIGNED_KEY = '__unassigned__';
const WEEKLY_COLUMN_COUNT = 11;
const JOB_COLUMN_COUNT = 4;

const invalidSnapshot = () => new Error('Payroll export is not ready for download');

const safeAdd = (left, right) => {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw invalidSnapshot();
  return result;
};

const stableSortKey = value => value
  .normalize('NFKD')
  .replace(/\p{Mark}/gu, '')
  .toLowerCase();

const compareText = (left, right) => {
  const leftKey = stableSortKey(left);
  const rightKey = stableSortKey(right);
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const compareEntries = (left, right) => (
  compareText(left.workDate, right.workDate)
  || compareText(left.startTimeLocal, right.startTimeLocal)
  || compareText(left.entryId, right.entryId)
);

const displayWorkerName = row => row.workerName ?? row.workerEmail ?? 'Former team member';

const freezeArray = values => Object.freeze(values);

const createWorkerGroups = snapshot => {
  const groups = new Map();

  for (const row of snapshot.rows) {
    let group = groups.get(row.workerReferenceId);
    if (!group) {
      group = {
        workerReferenceId: row.workerReferenceId,
        workerName: row.workerName,
        workerEmail: row.workerEmail,
        displayName: displayWorkerName(row),
        totalHoursHundredths: row.workerWeekTotalHoursHundredths,
        entries: [],
      };
      groups.set(row.workerReferenceId, group);
    }
    group.entries.push(row);
  }

  return freezeArray([...groups.values()]
    .map(group => Object.freeze({
      ...group,
      entries: freezeArray([...group.entries].sort(compareEntries)),
      totalHours: hundredthsToHours(group.totalHoursHundredths),
    }))
    .sort((left, right) => (
      compareText(left.displayName, right.displayName)
      || compareText(left.workerReferenceId, right.workerReferenceId)
    )));
};

const createJobGroups = snapshot => {
  const groups = new Map();

  for (const row of snapshot.rows) {
    const key = row.jobId ?? UNASSIGNED_KEY;
    let group = groups.get(key);
    if (!group) {
      group = {
        jobId: row.jobId,
        jobNumber: row.jobId === null ? null : row.jobNumber,
        jobName: row.jobId === null ? 'Unassigned' : row.jobName,
        workerReferenceIds: new Set(),
        totalHoursHundredths: 0,
      };
      groups.set(key, group);
    }
    group.workerReferenceIds.add(row.workerReferenceId);
    group.totalHoursHundredths = safeAdd(
      group.totalHoursHundredths,
      row.totalHoursHundredths,
    );
  }

  return freezeArray([...groups.values()]
    .map(group => Object.freeze({
      jobId: group.jobId,
      jobNumber: group.jobNumber,
      jobName: group.jobName,
      distinctWorkerCount: group.workerReferenceIds.size,
      totalHoursHundredths: group.totalHoursHundredths,
      totalHours: hundredthsToHours(group.totalHoursHundredths),
    }))
    .sort((left, right) => {
      if (left.jobId === null) return right.jobId === null ? 0 : 1;
      if (right.jobId === null) return -1;
      return compareText(left.jobNumber ?? '', right.jobNumber ?? '')
        || compareText(left.jobName ?? '', right.jobName ?? '')
        || compareText(left.jobId, right.jobId);
    }));
};

export function createPayrollCsvModel(snapshot) {
  if (
    !isParsedPayrollExportResponse(snapshot)
    || snapshot.state !== 'ready'
    || !Array.isArray(snapshot.rows)
    || !Number.isSafeInteger(snapshot.totalHoursHundredths)
  ) {
    throw invalidSnapshot();
  }

  const workerGroups = createWorkerGroups(snapshot);
  const jobGroups = createJobGroups(snapshot);
  const workerTotal = workerGroups.reduce(
    (total, group) => safeAdd(total, group.totalHoursHundredths),
    0,
  );
  const jobTotal = jobGroups.reduce(
    (total, group) => safeAdd(total, group.totalHoursHundredths),
    0,
  );

  if (workerTotal !== snapshot.totalHoursHundredths || jobTotal !== snapshot.totalHoursHundredths) {
    throw invalidSnapshot();
  }

  return Object.freeze({
    exportId: snapshot.exportId,
    version: snapshot.version,
    snapshotHash: snapshot.snapshotHash,
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    periodTimezone: snapshot.periodTimezone,
    createdAt: snapshot.createdAt,
    workerGroups,
    jobGroups,
    overallTotalHoursHundredths: snapshot.totalHoursHundredths,
    overallTotalHours: hundredthsToHours(snapshot.totalHoursHundredths),
  });
}

export const neutralizeSpreadsheetCell = value => {
  const text = value === null || value === undefined ? '' : String(value);
  return FORMULA_OR_LEADING_CONTROL_PATTERN.test(text) ? `'${text}` : text;
};

export const quoteCsvCell = value => `"${neutralizeSpreadsheetCell(value).replaceAll('"', '""')}"`;

const padRow = (values, columnCount) => {
  if (values.length > columnCount) throw invalidSnapshot();
  return [...values, ...Array(columnCount - values.length).fill('')];
};

const serializeRows = rows => `${CSV_BOM}${rows
  .map(row => row.map(quoteCsvCell).join(','))
  .join(CRLF)}${CRLF}`;

const metadataRows = (model, title, columnCount) => [
  padRow([title], columnCount),
  padRow(['Export ID', model.exportId], columnCount),
  padRow(['Export Version', model.version], columnCount),
  padRow(['Snapshot SHA-256', model.snapshotHash], columnCount),
  padRow(['Export Created At', model.createdAt], columnCount),
  padRow(['Pay Week Start', model.periodStart], columnCount),
  padRow(['Pay Week End', model.periodEnd], columnCount),
  padRow(['Timezone', model.periodTimezone], columnCount),
  padRow([], columnCount),
];

const dayName = dateKey => DAY_NAMES[new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()];

export function serializeWeeklyTimesheetCsv(model) {
  const rows = metadataRows(model, 'Weekly Timesheet', WEEKLY_COLUMN_COUNT);
  rows.push([
    'Record Type',
    'Worker',
    'Worker Email',
    'Work Date',
    'Day',
    'Job Number',
    'Job Name',
    'Start Local',
    'Finish Local',
    'Break Minutes',
    'Approved Hours',
  ]);

  for (const worker of model.workerGroups) {
    for (const entry of worker.entries) {
      rows.push([
        'Entry',
        worker.displayName,
        worker.workerEmail,
        entry.workDate,
        dayName(entry.workDate),
        entry.jobId === null ? '' : entry.jobNumber,
        entry.jobId === null ? 'Unassigned' : entry.jobName,
        entry.startTimeLocal,
        entry.finishTimeLocal,
        entry.lunchBreakMinutes,
        entry.totalHours,
      ]);
    }
    rows.push(padRow([
      'Worker subtotal',
      worker.displayName,
      worker.workerEmail,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      worker.totalHours,
    ], WEEKLY_COLUMN_COUNT));
  }

  rows.push(padRow([], WEEKLY_COLUMN_COUNT));
  rows.push(padRow([
    'Weekly grand total',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    model.overallTotalHours,
  ], WEEKLY_COLUMN_COUNT));
  rows.push(padRow([], WEEKLY_COLUMN_COUNT));
  rows.push(padRow(['Job labour-hours summary'], WEEKLY_COLUMN_COUNT));
  rows.push(padRow([
    'Record Type',
    'Job Number',
    'Job Name',
    'Distinct Worker Count',
    'Approved Hours',
  ], WEEKLY_COLUMN_COUNT));
  for (const job of model.jobGroups) {
    rows.push(padRow([
      'Job total',
      job.jobNumber,
      job.jobName,
      job.distinctWorkerCount,
      job.totalHours,
    ], WEEKLY_COLUMN_COUNT));
  }
  rows.push(padRow([
    'Job summary grand total',
    '',
    '',
    '',
    model.overallTotalHours,
  ], WEEKLY_COLUMN_COUNT));

  return serializeRows(rows);
}

export function serializeJobLabourHoursCsv(model) {
  const rows = metadataRows(model, 'Job Labour Hours', JOB_COLUMN_COUNT);
  rows.push(['Job Number', 'Job Name', 'Distinct Worker Count', 'Total Approved Hours']);

  for (const job of model.jobGroups) {
    rows.push([
      job.jobNumber,
      job.jobName,
      job.distinctWorkerCount,
      job.totalHours,
    ]);
  }
  rows.push(['Overall total', '', '', model.overallTotalHours]);

  return serializeRows(rows);
}
