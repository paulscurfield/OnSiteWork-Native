import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createTimesheetsAdminAdapter,
  sydneyDateTimeInputValue,
  sydneyLocalDateTimeToIso,
  timesheetAdminErrorMessage,
} from '../../src/api/supabase/timesheets-admin-adapter.js';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORKER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_WORKER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const ENTRY_ID = '33333333-3333-4333-8333-333333333333';
const PERIOD_ID = '44444444-4444-4444-8444-444444444444';
const JOB_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_JOB_ID = '66666666-6666-4666-8666-666666666666';
const RANGE = { periodStart: '2026-11-19', periodEnd: '2026-11-25' };
const START = '2026-11-19T21:00:00.000Z';
const FINISH = '2026-11-20T05:30:00.000Z';

const scope = (overrides = {}) => ({
  userId: USER_ID,
  companyId: COMPANY_ID,
  companyName: 'Alpha',
  role: 'admin',
  ...overrides,
});

const job = (overrides = {}) => ({
  id: JOB_ID,
  company_id: COMPANY_ID,
  job_name: 'Road works',
  job_number: 'J-100',
  status: 'active',
  ...overrides,
});

const entry = (overrides = {}) => ({
  id: ENTRY_ID,
  company_id: COMPANY_ID,
  worker_reference_id: WORKER_ID,
  worker_name: 'Taylor Worker',
  worker_email: 'taylor@example.invalid',
  job_id: JOB_ID,
  job_name: 'Road works',
  job_number: 'J-100',
  date: '2026-11-20',
  start_time: START,
  finish_time: FINISH,
  lunch_break_mins: 30,
  total_hours: 8,
  status: 'completed',
  notes: 'Normal shift',
  removed_at: null,
  periodStatus: 'open',
  ...overrides,
});

const returnedEntry = (overrides = {}) => ({
  ...entry(),
  status: 'manual',
  total_hours: 8,
  ...overrides,
});

const period = (overrides = {}) => ({
  id: PERIOD_ID,
  company_id: COMPANY_ID,
  worker_reference_id: WORKER_ID,
  worker_name: 'Taylor Worker',
  worker_email: 'taylor@example.invalid',
  period_start: RANGE.periodStart,
  period_end: RANGE.periodEnd,
  period_timezone: 'Australia/Sydney',
  status: 'approved',
  ...overrides,
});

const createHarness = (responses = []) => {
  const calls = [];
  const queue = [...responses];
  return {
    calls,
    getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
    rpc: async (name, params) => {
      calls.push([name, params]);
      if (!queue.length) throw new Error('Unexpected RPC call');
      const response = queue.shift();
      return typeof response === 'function' ? response(name, params) : response;
    },
  };
};

const manualInput = (overrides = {}) => ({
  companyId: COMPANY_ID,
  workerReferenceId: WORKER_ID,
  job: job(),
  workDate: '2026-11-20',
  startTime: START,
  finishTime: FINISH,
  lunchBreakMinutes: 30,
  notes: 'Manual correction',
  reason: 'Worker could not access the device',
  periodStatus: 'open',
  range: RANGE,
  ...overrides,
});

const correctionInput = (overrides = {}) => ({
  entry: entry(),
  job: job(),
  workDate: '2026-11-20',
  startTime: START,
  finishTime: FINISH,
  lunchBreakMinutes: 30,
  notes: 'Corrected shift',
  reason: 'Confirmed against supervisor records',
  range: RANGE,
  ...overrides,
});

const readSource = relativePath => fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('missing identity, workspace and Worker role fail before any RPC', async () => {
  for (const candidate of [
    scope({ userId: null }),
    scope({ companyId: null }),
    scope({ role: 'worker' }),
    scope({ role: 'supervisor' }),
  ]) {
    const harness = createHarness();
    await assert.rejects(
      () => createTimesheetsAdminAdapter(harness.getUser, harness.rpc).createManual(candidate, manualInput()),
      error => error.code === '42501',
    );
    assert.equal(harness.calls.length, 0);
  }
});

test('Owner and Admin can create a manual entry with the exact approved RPC arguments', async () => {
  for (const role of ['owner', 'admin']) {
    const harness = createHarness([{ data: { time_entry: returnedEntry() }, error: null }]);
    const result = await createTimesheetsAdminAdapter(harness.getUser, harness.rpc)
      .createManual(scope({ role }), manualInput());
    assert.equal(result.totalHours, 8);
    assert.deepEqual(harness.calls, [[
      'create_open_manual_time_entry_admin',
      {
        p_company_id: COMPANY_ID,
        p_worker_reference_id: WORKER_ID,
        p_job_id: JOB_ID,
        p_date: '2026-11-20',
        p_start_time: START,
        p_finish_time: FINISH,
        p_lunch_break_mins: 30,
        p_notes: 'Manual correction',
        p_reason: 'Worker could not access the device',
      },
    ]]);
  }
});

test('manual creation rejects locked periods, inactive Jobs and out-of-week dates without RPC calls', async () => {
  for (const input of [
    manualInput({ periodStatus: 'approved' }),
    manualInput({ job: job({ status: 'completed' }) }),
    manualInput({ workDate: '2026-11-26', startTime: '2026-11-25T21:00:00.000Z', finishTime: '2026-11-26T05:00:00.000Z' }),
  ]) {
    const harness = createHarness();
    await assert.rejects(() => createTimesheetsAdminAdapter(harness.getUser, harness.rpc).createManual(scope(), input));
    assert.equal(harness.calls.length, 0);
  }
});

test('manual response must preserve company, worker, Job, work date and manual status', async () => {
  for (const row of [
    returnedEntry({ company_id: OTHER_COMPANY_ID }),
    returnedEntry({ worker_reference_id: OTHER_WORKER_ID }),
    returnedEntry({ job_id: OTHER_JOB_ID }),
    returnedEntry({ status: 'completed' }),
  ]) {
    const harness = createHarness([{ data: { time_entry: row }, error: null }]);
    await assert.rejects(
      () => createTimesheetsAdminAdapter(harness.getUser, harness.rpc).createManual(scope(), manualInput()),
      /crossed/,
    );
  }
});

test('correction maps the exact RPC arguments and accepts canonical stored hours without recalculation', async () => {
  const response = returnedEntry({ status: 'completed', total_hours: 7.75, notes: 'Corrected shift' });
  const harness = createHarness([{ data: { time_entry: response }, error: null }]);
  const result = await createTimesheetsAdminAdapter(harness.getUser, harness.rpc).correct(scope(), correctionInput());
  assert.equal(result.totalHours, 7.75);
  assert.deepEqual(harness.calls[0], [
    'correct_open_time_entry_admin',
    {
      p_time_entry_id: ENTRY_ID,
      p_job_id: JOB_ID,
      p_date: '2026-11-20',
      p_start_time: START,
      p_finish_time: FINISH,
      p_lunch_break_mins: 30,
      p_notes: 'Corrected shift',
      p_reason: 'Confirmed against supervisor records',
    },
  ]);
});

test('correction rejects cross-company entries, locked periods and changed inactive Jobs', async () => {
  for (const input of [
    correctionInput({ entry: entry({ company_id: OTHER_COMPANY_ID }) }),
    correctionInput({ entry: entry({ periodStatus: 'approved' }) }),
    correctionInput({ job: job({ id: OTHER_JOB_ID, status: 'completed' }) }),
  ]) {
    const harness = createHarness();
    await assert.rejects(() => createTimesheetsAdminAdapter(harness.getUser, harness.rpc).correct(scope(), input));
    assert.equal(harness.calls.length, 0);
  }
});

test('stale-state conflict and permission denial propagate without fallback or retry', async () => {
  for (const error of [
    Object.assign(new Error('changed'), { code: '40001' }),
    Object.assign(new Error('denied'), { code: '42501' }),
  ]) {
    const harness = createHarness([{ data: null, error }]);
    await assert.rejects(
      () => createTimesheetsAdminAdapter(harness.getUser, harness.rpc).correct(scope(), correctionInput()),
      candidate => candidate === error,
    );
    assert.equal(harness.calls.length, 1);
  }
});

test('active recovery calls only recover_active_time_entry_admin and requires the active state', async () => {
  const active = entry({ status: 'active', finish_time: null, total_hours: null });
  const recovered = returnedEntry({ status: 'completed', finish_time: FINISH });
  const harness = createHarness([{ data: { time_entry: recovered }, error: null }]);
  await createTimesheetsAdminAdapter(harness.getUser, harness.rpc).recover(scope(), {
    entry: active,
    finishTime: FINISH,
    lunchBreakMinutes: 30,
    reason: 'Recovered from interrupted clock session',
    range: RANGE,
  });
  assert.deepEqual(harness.calls[0], [
    'recover_active_time_entry_admin',
    {
      p_time_entry_id: ENTRY_ID,
      p_finish_time: FINISH,
      p_lunch_break_mins: 30,
      p_reason: 'Recovered from interrupted clock session',
    },
  ]);

  const invalidHarness = createHarness();
  await assert.rejects(() => createTimesheetsAdminAdapter(invalidHarness.getUser, invalidHarness.rpc).recover(scope(), {
    entry: entry(), finishTime: FINISH, lunchBreakMinutes: 30, reason: 'Not active', range: RANGE,
  }), /not in a state/);
  assert.equal(invalidHarness.calls.length, 0);
});

test('recovery requires an explicit finish, valid elapsed duration and nonnegative break', async () => {
  const active = entry({ status: 'active', finish_time: null, total_hours: null });
  for (const values of [
    { finishTime: null, lunchBreakMinutes: 0 },
    { finishTime: START, lunchBreakMinutes: 0 },
    { finishTime: FINISH, lunchBreakMinutes: -1 },
    { finishTime: FINISH, lunchBreakMinutes: 999 },
  ]) {
    const harness = createHarness();
    await assert.rejects(() => createTimesheetsAdminAdapter(harness.getUser, harness.rpc).recover(scope(), {
      entry: active, ...values, reason: 'Recovery reason', range: RANGE,
    }));
    assert.equal(harness.calls.length, 0);
  }
});

test('void uses an audit reason and validates the exact non-delete response', async () => {
  const harness = createHarness([{ data: { removed: true, id: ENTRY_ID }, error: null }]);
  const result = await createTimesheetsAdminAdapter(harness.getUser, harness.rpc).void(scope(), {
    entry: entry(), reason: 'Duplicate entry confirmed', range: RANGE,
  });
  assert.deepEqual(result, { id: ENTRY_ID, removed: true });
  assert.deepEqual(harness.calls[0], ['void_open_time_entry_admin', {
    p_time_entry_id: ENTRY_ID,
    p_reason: 'Duplicate entry confirmed',
  }]);

  const invalidHarness = createHarness();
  await assert.rejects(() => createTimesheetsAdminAdapter(invalidHarness.getUser, invalidHarness.rpc).void(scope(), {
    entry: entry(), reason: '   ', range: RANGE,
  }), /Void reason is required/);
  assert.equal(invalidHarness.calls.length, 0);
});

test('finalisation maps worker and canonical period start and validates locked response totals', async () => {
  const harness = createHarness([{ data: {
    timesheet_period: period(),
    entry_count: 2,
    total_locked_hours: '15.75',
  }, error: null }]);
  const result = await createTimesheetsAdminAdapter(harness.getUser, harness.rpc).finalise(scope(), {
    workerReferenceId: WORKER_ID,
    periodStatus: 'open',
    entryCount: 2,
    hasActiveEntries: false,
    range: RANGE,
  });
  assert.equal(result.status, 'approved');
  assert.equal(result.totalLockedHours, 15.75);
  assert.deepEqual(harness.calls[0], ['finalise_timesheet_period_admin', {
    p_worker_reference_id: WORKER_ID,
    p_period_date: RANGE.periodStart,
  }]);
});

test('finalisation rejects empty, active, submitted and malformed period states before RPC', async () => {
  for (const input of [
    { periodStatus: 'open', entryCount: 0, hasActiveEntries: false },
    { periodStatus: 'open', entryCount: 1, hasActiveEntries: true },
    { periodStatus: 'submitted', entryCount: 1, hasActiveEntries: false },
    { periodStatus: 'unexpected', entryCount: 1, hasActiveEntries: false },
  ]) {
    const harness = createHarness();
    await assert.rejects(() => createTimesheetsAdminAdapter(harness.getUser, harness.rpc).finalise(scope(), {
      workerReferenceId: WORKER_ID, range: RANGE, ...input,
    }));
    assert.equal(harness.calls.length, 0);
  }
});

test('reopen passes only period ID and explicit reason and accepts historical submitted periods', async () => {
  for (const sourceStatus of ['approved', 'submitted']) {
    const source = period({ status: sourceStatus });
    const harness = createHarness([{ data: { timesheet_period: period({ status: 'open' }) }, error: null }]);
    const result = await createTimesheetsAdminAdapter(harness.getUser, harness.rpc).reopen(scope(), {
      period: source,
      reason: 'Correction requested by payroll reviewer',
      range: RANGE,
    });
    assert.equal(result.status, 'open');
    assert.deepEqual(harness.calls[0], ['reopen_timesheet_period_admin', {
      p_timesheet_period_id: PERIOD_ID,
      p_reason: 'Correction requested by payroll reviewer',
    }]);
  }
});

test('reopen rejects open, cross-company and missing-reason periods', async () => {
  for (const input of [
    { period: period({ status: 'open' }), reason: 'No state change needed' },
    { period: period({ company_id: OTHER_COMPANY_ID }), reason: 'Wrong company' },
    { period: period(), reason: '' },
  ]) {
    const harness = createHarness();
    await assert.rejects(() => createTimesheetsAdminAdapter(harness.getUser, harness.rpc).reopen(scope(), {
      ...input, range: RANGE,
    }));
    assert.equal(harness.calls.length, 0);
  }
});

test('all operations reject malformed RPC responses and general backend failure', async () => {
  const malformed = createHarness([{ data: { time_entry: { id: ENTRY_ID } }, error: null }]);
  await assert.rejects(
    () => createTimesheetsAdminAdapter(malformed.getUser, malformed.rpc).createManual(scope(), manualInput()),
    /response was invalid|must be a Supabase UUID/,
  );
  const failure = new Error('network unavailable');
  const failed = createHarness([{ data: null, error: failure }]);
  await assert.rejects(
    () => createTimesheetsAdminAdapter(failed.getUser, failed.rpc).void(scope(), { entry: entry(), reason: 'Confirmed error', range: RANGE }),
    candidate => candidate === failure,
  );
});

test('authentication is rechecked immediately before RPC and identity changes fail closed', async () => {
  const harness = createHarness([{ data: { time_entry: returnedEntry() }, error: null }]);
  harness.getUser = async () => ({ data: { user: { id: OTHER_WORKER_ID } }, error: null });
  await assert.rejects(
    () => createTimesheetsAdminAdapter(harness.getUser, harness.rpc).createManual(scope(), manualInput()),
    error => error.code === '42501',
  );
  assert.equal(harness.calls.length, 0);
});

test('duplicate submission is rejected while the first non-idempotent mutation remains in flight', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const harness = createHarness([async () => pending]);
  const adapter = createTimesheetsAdminAdapter(harness.getUser, harness.rpc);
  const first = adapter.createManual(scope(), manualInput());
  await Promise.resolve();
  await Promise.resolve();
  await assert.rejects(() => adapter.createManual(scope(), manualInput()), error => error.code === '409');
  assert.equal(harness.calls.length, 1);
  release({ data: { time_entry: returnedEntry() }, error: null });
  await first;
});

test('Australia/Sydney conversion handles overnight shifts without browser-local arithmetic', () => {
  assert.equal(sydneyLocalDateTimeToIso('2026-11-20T08:00'), START);
  assert.equal(sydneyLocalDateTimeToIso('2026-11-20T16:30'), FINISH);
  assert.equal(sydneyDateTimeInputValue(START), '2026-11-20T08:00');
  assert.equal(sydneyDateTimeInputValue(FINISH), '2026-11-20T16:30');
});

test('error messages distinguish permission, stale state, incomplete periods and uncertain outcomes', () => {
  assert.match(timesheetAdminErrorMessage({ code: '42501', message: 'denied' }), /workspace/);
  assert.match(timesheetAdminErrorMessage({ code: '40001', message: 'changed' }), /Refresh/);
  assert.match(timesheetAdminErrorMessage({ code: '23514', message: 'Active Time Entries must be finished' }), /active entry/);
  assert.match(timesheetAdminErrorMessage(new Error('offline')), /outcome could not be confirmed/);
});

test('Owner/Admin controls are scoped, confirmed and absent from the Worker path', () => {
  const page = readSource('src/pages/Timesheets.jsx');
  const dialog = readSource('src/components/timesheets/TimesheetAdminActionDialog.jsx');
  assert.match(page, /view === 'company' \? 'Owner\/Admin review' : 'Read only'/);
  assert.match(page, /view !== 'company'/);
  assert.match(page, /currentAdminResources\.state !== 'ready'/);
  assert.match(page, /periodStatus === 'open'/);
  assert.match(dialog, /Confirm this administrative action/);
  assert.match(dialog, /type="checkbox"/);
  assert.match(dialog, /it may already have been exported/);
});

test('workspace, role or pay-week changes discard dialogs and late mutation outcomes', () => {
  const page = readSource('src/pages/Timesheets.jsx');
  assert.match(page, /activeMutationContextRef\.current = requestKey/);
  assert.match(page, /adminAction\.contextKey !== requestKey/);
  assert.match(page, /activeMutationContextRef\.current !== contextKey/);
  assert.match(page, /setAdminAction\(null\)/);
  assert.match(page, /requestId !== requestIdRef\.current/);
  assert.match(page, /setReloadVersion\(version => version \+ 1\)/);
});

test('confirmed mutations refresh authoritative reads without speculative payroll changes', () => {
  const page = readSource('src/pages/Timesheets.jsx');
  assert.match(page, /await onsiteApi\.timesheetsAdmin\./);
  assert.match(page, /Authoritative records have been refreshed/);
  assert.equal(/setResult\([^)]*time_entry/.test(page), false);
  assert.equal(/setResult\([^)]*timesheet_period/.test(page), false);
  assert.equal(page.includes('create_payroll_export_admin'), false);
  assert.equal(page.includes('get_payroll_export_admin'), false);
  assert.equal(page.includes('submit_my_timesheet_period'), false);
});

test('adapter exposes exactly the six approved administrative RPC names and no table mutations', () => {
  const adapter = readSource('src/api/supabase/timesheets-admin-adapter.js');
  for (const rpc of [
    'create_open_manual_time_entry_admin',
    'correct_open_time_entry_admin',
    'recover_active_time_entry_admin',
    'void_open_time_entry_admin',
    'finalise_timesheet_period_admin',
    'reopen_timesheet_period_admin',
  ]) assert.match(adapter, new RegExp(`'${rpc}'`));
  for (const forbidden of ['supabase.from(', '.insert(', '.update(', 'service_role', 'create_payroll_export_admin', 'submit_my_timesheet_period']) {
    assert.equal(adapter.includes(forbidden), false, forbidden);
  }
});
