import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hoursToHundredths,
  hundredthsToHours,
  parsePayrollExportResponse,
} from '../../src/lib/payroll-export-contract.js';

const IDS = {
  export: '10000000-0000-4000-8000-000000000001',
  request: '10000000-0000-4000-8000-000000000002',
  workerA: '20000000-0000-4000-8000-000000000001',
  workerB: '20000000-0000-4000-8000-000000000002',
  periodA: '30000000-0000-4000-8000-000000000001',
  periodB: '30000000-0000-4000-8000-000000000002',
  jobA: '40000000-0000-4000-8000-000000000001',
  jobB: '40000000-0000-4000-8000-000000000002',
  entryA: '50000000-0000-4000-8000-000000000001',
  entryB: '50000000-0000-4000-8000-000000000002',
  entryC: '50000000-0000-4000-8000-000000000003',
  entryD: '50000000-0000-4000-8000-000000000004',
};

const row = overrides => ({
  entry_id: IDS.entryA,
  worker_reference_id: IDS.workerA,
  worker_name: 'Alex Example',
  worker_email: 'alex@example.invalid',
  period_id: IDS.periodA,
  locked_at_utc: '2026-11-26T01:00:00.000000Z',
  work_date: '2026-11-23',
  start_time_utc: '2026-11-22T21:00:00.000000Z',
  finish_time_utc: '2026-11-23T01:30:00.000000Z',
  start_time_local: '2026-11-23T08:00:00.000000',
  finish_time_local: '2026-11-23T12:30:00.000000',
  period_timezone: 'Australia/Sydney',
  lunch_break_minutes: 30,
  total_hours: '4.00',
  worker_week_total_hours: '8.25',
  entry_status: 'completed',
  job_id: IDS.jobA,
  job_number: 'J-100',
  job_name: 'Fictional Library',
  ...overrides,
});

const validPayload = () => ({
  state: 'ready',
  export_id: IDS.export,
  request_id: IDS.request,
  version: 3,
  period_start: '2026-11-23',
  period_end: '2026-11-29',
  period_timezone: 'Australia/Sydney',
  created_at: '2026-11-26T01:02:03.456+00:00',
  worker_count: 2,
  row_count: 4,
  total_hours: '17.50',
  locked_period_ids: [IDS.periodA, IDS.periodB],
  snapshot_hash: 'a'.repeat(64),
  rows: [
    row({}),
    row({
      entry_id: IDS.entryB,
      work_date: '2026-11-24',
      start_time_utc: '2026-11-23T21:00:00.000000Z',
      finish_time_utc: '2026-11-24T01:45:00.000000Z',
      start_time_local: '2026-11-24T08:00:00.000000',
      finish_time_local: '2026-11-24T12:45:00.000000',
      lunch_break_minutes: 0,
      total_hours: '4.25',
      entry_status: 'manual',
      job_id: IDS.jobB,
      job_number: 'J-200',
      job_name: 'Synthetic Wharf',
    }),
    row({
      entry_id: IDS.entryC,
      worker_reference_id: IDS.workerB,
      worker_name: null,
      worker_email: 'blair@example.invalid',
      period_id: IDS.periodB,
      work_date: '2026-11-25',
      start_time_utc: '2026-11-24T19:00:00.000000Z',
      finish_time_utc: '2026-11-25T03:00:00.000000Z',
      start_time_local: '2026-11-25T06:00:00.000000',
      finish_time_local: '2026-11-25T14:00:00.000000',
      lunch_break_minutes: 60,
      total_hours: '7.00',
      worker_week_total_hours: '9.25',
    }),
    row({
      entry_id: IDS.entryD,
      worker_reference_id: IDS.workerB,
      worker_name: null,
      worker_email: 'blair@example.invalid',
      period_id: IDS.periodB,
      work_date: '2026-11-27',
      start_time_utc: '2026-11-27T10:00:00.000000Z',
      finish_time_utc: '2026-11-27T12:15:00.000000Z',
      start_time_local: '2026-11-27T21:00:00.000000',
      finish_time_local: '2026-11-27T23:15:00.000000',
      lunch_break_minutes: 0,
      total_hours: '2.25',
      worker_week_total_hours: '9.25',
      job_id: null,
      job_number: 'Historic text is ignored for grouping',
      job_name: null,
    }),
  ],
});

const invalid = payload => assert.throws(
  () => parsePayrollExportResponse(payload),
  error => error.message === 'Payroll export response was invalid',
);

test('valid ready snapshot is strictly parsed, reconciled and frozen', () => {
  const parsed = parsePayrollExportResponse(validPayload(), IDS.request);
  assert.equal(parsed.state, 'ready');
  assert.equal(parsed.totalHoursHundredths, 1750);
  assert.equal(parsed.rows[1].totalHoursHundredths, 425);
  assert.equal(parsed.rows[3].jobId, null);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.rows), true);
  assert.equal(Object.isFrozen(parsed.rows[0]), true);
  assert.equal(Object.isFrozen(parsed.lockedPeriodIds), true);
});

test('no_data is a distinct exact non-downloadable contract state', () => {
  const payload = {
    state: 'no_data',
    period_start: '2026-11-23',
    period_end: '2026-11-29',
    period_timezone: 'Australia/Sydney',
  };
  assert.deepEqual(parsePayrollExportResponse(payload), {
    state: 'no_data',
    periodStart: '2026-11-23',
    periodEnd: '2026-11-29',
    periodTimezone: 'Australia/Sydney',
  });
  invalid({ ...payload, rows: [] });
});

test('missing, unexpected and incorrectly typed fields fail closed', () => {
  const missing = validPayload();
  delete missing.snapshot_hash;
  invalid(missing);

  invalid({ ...validPayload(), company_id: IDS.jobA });
  invalid({ ...validPayload(), worker_count: '2' });
  invalid({ ...validPayload(), rows: {} });

  const unexpectedRow = validPayload();
  unexpectedRow.rows[0].notes = 'must not be accepted';
  invalid(unexpectedRow);
});

test('UUID fields and expected request identity are validated', () => {
  for (const mutate of [
    payload => { payload.export_id = 'not-a-uuid'; },
    payload => { payload.request_id = 'not-a-uuid'; },
    payload => { payload.locked_period_ids[0] = 'not-a-uuid'; },
    payload => { payload.rows[0].entry_id = 'not-a-uuid'; },
    payload => { payload.rows[0].worker_reference_id = 'not-a-uuid'; },
    payload => { payload.rows[0].period_id = 'not-a-uuid'; },
    payload => { payload.rows[0].job_id = 'not-a-uuid'; },
  ]) {
    const payload = validPayload();
    mutate(payload);
    invalid(payload);
  }
  assert.throws(() => parsePayrollExportResponse(validPayload(), IDS.export));
});

test('calendar range, timezone and timestamp formats are strict', () => {
  for (const mutate of [
    payload => { payload.period_start = '2026-02-30'; },
    payload => { payload.period_end = '2026-11-30'; },
    payload => { payload.period_timezone = 'Not/A_Timezone'; },
    payload => { payload.created_at = '26 November 2026'; },
    payload => { payload.rows[0].locked_at_utc = '2026-11-26T01:00:00+11:00'; },
    payload => { payload.rows[0].start_time_utc = '2026-11-22T99:00:00Z'; },
    payload => { payload.rows[0].finish_time_local = '2026-11-23T25:00:00'; },
    payload => { payload.rows[0].work_date = '2026-11-30'; },
    payload => { payload.rows[0].period_timezone = 'UTC'; },
  ]) {
    const payload = validPayload();
    mutate(payload);
    invalid(payload);
  }
});

test('hash, version and ready counts enforce the committed backend contract', () => {
  for (const mutate of [
    payload => { payload.snapshot_hash = 'A'.repeat(64); },
    payload => { payload.snapshot_hash = 'a'.repeat(63); },
    payload => { payload.version = 0; },
    payload => { payload.version = 1.5; },
    payload => { payload.worker_count = 0; },
    payload => { payload.worker_count = -1; },
    payload => { payload.row_count = Number.MAX_SAFE_INTEGER + 1; },
  ]) {
    const payload = validPayload();
    mutate(payload);
    invalid(payload);
  }
});

test('canonical hours accept only nonnegative two-decimal strings', () => {
  assert.equal(hoursToHundredths('0.05'), 5);
  assert.equal(hoursToHundredths('25.50'), 2550);
  assert.equal(hundredthsToHours(5), '0.05');
  assert.equal(hundredthsToHours(2550), '25.50');

  for (const value of ['-1.00', '1', '1.0', '1.000', '01.00', 'NaN', 'Infinity', 1.25]) {
    assert.throws(() => hoursToHundredths(value));
  }
});

test('duplicate entries, invalid breaks and undocumented statuses are rejected', () => {
  const duplicate = validPayload();
  duplicate.rows[1].entry_id = duplicate.rows[0].entry_id;
  invalid(duplicate);

  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const payload = validPayload();
    payload.rows[0].lunch_break_minutes = value;
    invalid(payload);
  }

  const status = validPayload();
  status.rows[0].entry_status = 'approved';
  invalid(status);
});

test('conflicting historical worker and job labels fail closed', () => {
  for (const mutate of [
    payload => { payload.rows[1].worker_name = 'Different worker'; },
    payload => { payload.rows[1].worker_email = 'other@example.invalid'; },
    payload => { payload.rows[2].job_number = 'DIFFERENT'; },
    payload => { payload.rows[2].job_name = 'Different job'; },
  ]) {
    const payload = validPayload();
    mutate(payload);
    invalid(payload);
  }
});

test('worker subtotals and top-level totals reconcile exactly in integer hundredths', () => {
  const inconsistentWorker = validPayload();
  inconsistentWorker.rows[1].worker_week_total_hours = '8.50';
  invalid(inconsistentWorker);

  const wrongWorkerTotal = validPayload();
  wrongWorkerTotal.rows[0].worker_week_total_hours = '8.30';
  wrongWorkerTotal.rows[1].worker_week_total_hours = '8.30';
  invalid(wrongWorkerTotal);

  const wrongGrandTotal = validPayload();
  wrongGrandTotal.total_hours = '17.55';
  invalid(wrongGrandTotal);

  const changedJobAllocation = validPayload();
  changedJobAllocation.rows[2].total_hours = '7.05';
  invalid(changedJobAllocation);
});

test('declared row and worker counts and locked-period coverage are exact', () => {
  const rowCount = validPayload();
  rowCount.row_count = 3;
  invalid(rowCount);

  const workerCount = validPayload();
  workerCount.worker_count = 3;
  invalid(workerCount);

  const duplicatePeriod = validPayload();
  duplicatePeriod.locked_period_ids[1] = duplicatePeriod.locked_period_ids[0];
  invalid(duplicatePeriod);

  const unusedPeriod = validPayload();
  unusedPeriod.locked_period_ids.push('30000000-0000-4000-8000-000000000003');
  invalid(unusedPeriod);
});

test('hours parsing and aggregation reject unsafe-integer overflow', () => {
  assert.throws(() => hoursToHundredths('90071992547410.00'));

  const payload = validPayload();
  payload.worker_count = 1;
  payload.row_count = 2;
  payload.locked_period_ids = [IDS.periodA];
  payload.total_hours = '90071992547409.91';
  payload.rows = [
    row({ total_hours: '45035996273705.00', worker_week_total_hours: '90071992547409.91' }),
    row({
      entry_id: IDS.entryB,
      total_hours: '45035996273705.00',
      worker_week_total_hours: '90071992547409.91',
    }),
  ];
  invalid(payload);
});

test('validation errors never echo snapshot content', () => {
  const payload = validPayload();
  payload.rows[0].worker_name = 'Sensitive Synthetic Name';
  payload.rows[1].worker_name = 'Conflicting Synthetic Name';
  assert.throws(
    () => parsePayrollExportResponse(payload),
    error => !error.message.includes('Sensitive') && !error.message.includes('Conflicting'),
  );
});
