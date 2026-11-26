import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePayrollExportResponse } from '../../src/lib/payroll-export-contract.js';
import {
  createPayrollCsvModel,
  neutralizeSpreadsheetCell,
  quoteCsvCell,
  serializeJobLabourHoursCsv,
  serializeWeeklyTimesheetCsv,
} from '../../src/lib/payroll-csv.js';

const id = (group, suffix) => `${group}0000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;

const WORKERS = {
  amy: id(2, 1),
  former: id(2, 2),
  caseyA: id(2, 3),
  caseyB: id(2, 4),
  zoe: id(2, 5),
};
const JOBS = { alpha: id(4, 1), duplicateA: id(4, 2), duplicateB: id(4, 3) };
const PERIODS = {
  amy: id(3, 1),
  former: id(3, 2),
  caseyA: id(3, 3),
  caseyB: id(3, 4),
  zoe: id(3, 5),
};

const entry = ({
  entryId,
  workerId,
  workerName,
  workerEmail,
  periodId,
  date,
  startLocal,
  finishLocal,
  hours,
  workerTotal,
  jobId,
  jobNumber,
  jobName,
  breakMinutes = 0,
  status = 'completed',
}) => ({
  entry_id: entryId,
  worker_reference_id: workerId,
  worker_name: workerName,
  worker_email: workerEmail,
  period_id: periodId,
  locked_at_utc: '2026-11-30T01:00:00.000000Z',
  work_date: date,
  start_time_utc: `${date}T00:00:00.000000Z`,
  finish_time_utc: `${date}T01:00:00.000000Z`,
  start_time_local: startLocal,
  finish_time_local: finishLocal,
  period_timezone: 'Australia/Sydney',
  lunch_break_minutes: breakMinutes,
  total_hours: hours,
  worker_week_total_hours: workerTotal,
  entry_status: status,
  job_id: jobId,
  job_number: jobNumber,
  job_name: jobName,
});

const fixture = () => ({
  state: 'ready',
  export_id: id(1, 1),
  request_id: id(1, 2),
  version: 7,
  period_start: '2026-11-23',
  period_end: '2026-11-29',
  period_timezone: 'Australia/Sydney',
  created_at: '2026-11-30T01:02:03.456Z',
  worker_count: 5,
  row_count: 6,
  total_hours: '16.50',
  locked_period_ids: Object.values(PERIODS),
  snapshot_hash: 'b'.repeat(64),
  rows: [
    entry({
      entryId: id(5, 2),
      workerId: WORKERS.amy,
      workerName: 'Amy Admin',
      workerEmail: 'amy@example.invalid',
      periodId: PERIODS.amy,
      date: '2026-11-24',
      startLocal: '2026-11-24T13:00:00.000000',
      finishLocal: '2026-11-24T15:30:00.000000',
      hours: '2.50',
      workerTotal: '3.75',
      jobId: JOBS.duplicateA,
      jobNumber: 'J-200',
      jobName: 'Same label',
      status: 'manual',
    }),
    entry({
      entryId: id(5, 1),
      workerId: WORKERS.amy,
      workerName: 'Amy Admin',
      workerEmail: 'amy@example.invalid',
      periodId: PERIODS.amy,
      date: '2026-11-24',
      startLocal: '2026-11-24T08:00:00.000000',
      finishLocal: '2026-11-24T09:15:00.000000',
      hours: '1.25',
      workerTotal: '3.75',
      jobId: JOBS.alpha,
      jobNumber: 'J-100',
      jobName: 'Harbour, "North"\nStage 1',
    }),
    entry({
      entryId: id(5, 3),
      workerId: WORKERS.former,
      workerName: null,
      workerEmail: null,
      periodId: PERIODS.former,
      date: '2026-11-25',
      startLocal: '2026-11-25T08:00:00.000000',
      finishLocal: '2026-11-25T12:30:00.000000',
      hours: '4.00',
      workerTotal: '4.00',
      jobId: null,
      jobNumber: 'Historic J-999',
      jobName: 'Historic label',
      breakMinutes: 30,
    }),
    entry({
      entryId: id(5, 4),
      workerId: WORKERS.caseyA,
      workerName: 'Casey Same',
      workerEmail: 'casey-a@example.invalid',
      periodId: PERIODS.caseyA,
      date: '2026-11-26',
      startLocal: '2026-11-26T08:00:00.000000',
      finishLocal: '2026-11-26T08:05:00.000000',
      hours: '0.05',
      workerTotal: '0.05',
      jobId: JOBS.alpha,
      jobNumber: 'J-100',
      jobName: 'Harbour, "North"\nStage 1',
    }),
    entry({
      entryId: id(5, 5),
      workerId: WORKERS.caseyB,
      workerName: 'Casey Same',
      workerEmail: 'casey-b@example.invalid',
      periodId: PERIODS.caseyB,
      date: '2026-11-27',
      startLocal: '2026-11-27T09:00:00.000000',
      finishLocal: '2026-11-27T10:12:00.000000',
      hours: '1.20',
      workerTotal: '1.20',
      jobId: JOBS.duplicateB,
      jobNumber: 'J-200',
      jobName: 'Same label',
    }),
    entry({
      entryId: id(5, 6),
      workerId: WORKERS.zoe,
      workerName: 'Zoë Worker',
      workerEmail: 'zoe@example.invalid',
      periodId: PERIODS.zoe,
      date: '2026-11-28',
      startLocal: '2026-11-28T22:00:00.000000',
      finishLocal: '2026-11-29T06:00:00.000000',
      hours: '7.50',
      workerTotal: '7.50',
      jobId: JOBS.alpha,
      jobNumber: 'J-100',
      jobName: 'Harbour, "North"\nStage 1',
      breakMinutes: 30,
    }),
  ],
});

const model = payload => createPayrollCsvModel(parsePayrollExportResponse(payload));

test('shared model is frozen, reconciled and sorts workers deterministically', () => {
  const result = model(fixture());
  assert.deepEqual(
    result.workerGroups.map(group => [group.displayName, group.workerReferenceId]),
    [
      ['Amy Admin', WORKERS.amy],
      ['Casey Same', WORKERS.caseyA],
      ['Casey Same', WORKERS.caseyB],
      ['Former team member', WORKERS.former],
      ['Zoë Worker', WORKERS.zoe],
    ],
  );
  assert.equal(result.overallTotalHours, '16.50');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.workerGroups), true);
  assert.equal(Object.isFrozen(result.workerGroups[0].entries), true);
});

test('same-day entries are chronological and retain separate cross-job rows', () => {
  const result = model(fixture());
  const amy = result.workerGroups[0];
  assert.deepEqual(amy.entries.map(item => item.entryId), [id(5, 1), id(5, 2)]);
  assert.deepEqual(amy.entries.map(item => item.jobId), [JOBS.alpha, JOBS.duplicateA]);
  assert.equal(amy.totalHours, '3.75');
});

test('job groups retain distinct stable IDs, worker counts and unassigned hours', () => {
  const result = model(fixture());
  assert.deepEqual(
    result.jobGroups.map(job => [
      job.jobId,
      job.jobNumber,
      job.jobName,
      job.distinctWorkerCount,
      job.totalHours,
    ]),
    [
      [JOBS.alpha, 'J-100', 'Harbour, "North"\nStage 1', 3, '8.80'],
      [JOBS.duplicateA, 'J-200', 'Same label', 1, '2.50'],
      [JOBS.duplicateB, 'J-200', 'Same label', 1, '1.20'],
      [null, null, 'Unassigned', 1, '4.00'],
    ],
  );
  assert.equal(result.jobGroups.reduce((sum, job) => sum + job.totalHoursHundredths, 0), 1650);
});

test('no_data cannot be turned into an empty report', () => {
  const noData = parsePayrollExportResponse({
    state: 'no_data',
    period_start: '2026-11-23',
    period_end: '2026-11-29',
    period_timezone: 'Australia/Sydney',
  });
  assert.throws(
    () => createPayrollCsvModel(noData),
    /not ready for download/u,
  );
});

test('shared model rejects lookalike objects that bypassed the strict parser', () => {
  const parsed = parsePayrollExportResponse(fixture());
  assert.throws(
    () => createPayrollCsvModel({ ...parsed }),
    /not ready for download/u,
  );
});

test('weekly CSV includes immutable identity, local timestamps, day names and totals', () => {
  const csv = serializeWeeklyTimesheetCsv(model(fixture()));
  for (const expected of [
    '"Weekly Timesheet"',
    `"Export ID","${id(1, 1)}"`,
    '"Export Version","7"',
    `"Snapshot SHA-256","${'b'.repeat(64)}"`,
    '"Pay Week Start","2026-11-23"',
    '"Pay Week End","2026-11-29"',
    '"Timezone","Australia/Sydney"',
    '"2026-11-24","Tuesday"',
    '"2026-11-28","Saturday"',
    '"2026-11-28T22:00:00.000000","2026-11-29T06:00:00.000000"',
    '"Worker subtotal","Amy Admin"',
    '"Weekly grand total"',
    '"16.50"',
    '"Job labour-hours summary"',
  ]) {
    assert.equal(csv.includes(expected), true, expected);
  }
});

test('job CSV includes each stable group, Unassigned and the same grand total', () => {
  const result = model(fixture());
  const csv = serializeJobLabourHoursCsv(result);
  assert.match(csv, /"Job Labour Hours"/u);
  assert.match(csv, /"J-100","Harbour, ""North""\nStage 1","3","8\.80"/u);
  assert.equal((csv.match(/"J-200","Same label"/gu) || []).length, 2);
  assert.match(csv, /"","Unassigned","1","4\.00"/u);
  assert.match(csv, /"Overall total","","","16\.50"/u);
  assert.equal(serializeWeeklyTimesheetCsv(result).includes('"16.50"'), true);
});

test('both serializers are byte-for-byte deterministic on repeat download', () => {
  const result = model(fixture());
  assert.equal(serializeWeeklyTimesheetCsv(result), serializeWeeklyTimesheetCsv(result));
  assert.equal(serializeJobLabourHoursCsv(result), serializeJobLabourHoursCsv(result));
});

test('CSV output uses a BOM, quoted cells, CRLF records and a final CRLF', () => {
  const result = model(fixture());
  for (const csv of [serializeWeeklyTimesheetCsv(result), serializeJobLabourHoursCsv(result)]) {
    assert.equal(csv.startsWith('\uFEFF"'), true);
    assert.equal(csv.endsWith('\r\n'), true);
    assert.equal(csv.includes('\r\n'), true);
    for (const record of csv.replace(/^\uFEFF/u, '').split('\r\n').filter(Boolean)) {
      assert.equal(record.startsWith('"'), true);
    }
  }
});

test('CSV quoting preserves commas, quotes, multiline text and UTF-8 names', () => {
  const csv = serializeWeeklyTimesheetCsv(model(fixture()));
  assert.match(csv, /"Harbour, ""North""\nStage 1"/u);
  assert.match(csv, /"Zoë Worker"/u);
  assert.equal(quoteCsvCell('A, "quoted"\nvalue'), '"A, ""quoted""\nvalue"');
});

test('spreadsheet formula and control prefixes are neutralised with an apostrophe', () => {
  for (const value of [
    '=1+1',
    '+SUM(A1:A2)',
    '-J-100',
    '@cmd',
    ' =1+1',
    '\t=1+1',
    '\n=1+1',
    '\r=1+1',
    '\u0000=1+1',
  ]) {
    assert.equal(neutralizeSpreadsheetCell(value), `'${value}`);
    assert.equal(quoteCsvCell(value).startsWith('"\''), true);
  }
  assert.equal(neutralizeSpreadsheetCell('J-100'), 'J-100');
});

test('adversarial worker, email and job labels cannot become spreadsheet formulas', () => {
  const payload = fixture();
  for (const row of payload.rows.filter(item => item.worker_reference_id === WORKERS.amy)) {
    row.worker_name = '  =WEBSERVICE("https://example.invalid")';
    row.worker_email = '+amy@example.invalid';
  }
  for (const row of payload.rows.filter(item => item.job_id === JOBS.duplicateA)) {
    row.job_number = '-J-200';
    row.job_name = '\t@SUM(A1:A2)';
  }

  const result = model(payload);
  const weekly = serializeWeeklyTimesheetCsv(result);
  const jobs = serializeJobLabourHoursCsv(result);
  for (const expected of [
    `'  =WEBSERVICE(""https://example.invalid"")`,
    "'+amy@example.invalid",
    "'-J-200",
    "'\t@SUM(A1:A2)",
  ]) {
    assert.equal(`${weekly}${jobs}`.includes(expected), true, expected);
  }
});

test('approved hours come only from snapshot decimals, including zero break and fractions', () => {
  const result = model(fixture());
  const amy = result.workerGroups.find(worker => worker.workerReferenceId === WORKERS.amy);
  assert.equal(amy.entries[0].lunchBreakMinutes, 0);
  assert.equal(amy.entries[0].totalHours, '1.25');
  assert.equal(amy.entries[1].totalHours, '2.50');
  assert.equal(amy.totalHoursHundredths, 375);
  assert.equal(result.overallTotalHoursHundredths, 1650);
});
