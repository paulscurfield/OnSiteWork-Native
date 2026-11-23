import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  calculateStoredTimesheetHours,
  calculateTimesheetPayWeek,
  createTimesheetsReadAdapter,
  mapTimeEntryRow,
  mapTimesheetPeriodRow,
} from '../../src/api/supabase/timesheets-read-adapter.js';
import {
  canReadCompanyTimesheets,
  createTimesheetRequestKey,
  normalizeTimesheetRole,
  resolveTimesheetReadScope,
} from '../../src/lib/timesheet-access.js';
import {
  DASHBOARD_MODULES,
  getJobRecordsPath,
  JOB_FIRST_MODULES,
} from '../../src/navigation/dashboard-modules.js';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const ENTRY_ID = '33333333-3333-4333-8333-333333333333';
const PERIOD_ID = '44444444-4444-4444-8444-444444444444';
const JOB_ID = '55555555-5555-4555-8555-555555555555';
const RANGE = { periodStart: '2026-10-01', periodEnd: '2026-10-07' };

const workerScope = { userId: USER_ID, companyId: COMPANY_ID, companyName: 'Alpha', role: 'worker' };
const adminScope = { userId: ADMIN_ID, companyId: COMPANY_ID, companyName: 'Alpha', role: 'admin' };
const companyRow = { id: COMPANY_ID, pay_week_start_day: 4 };
const entryRow = (overrides = {}) => ({
  id: ENTRY_ID,
  company_id: COMPANY_ID,
  worker_reference_id: USER_ID,
  worker_name: 'Taylor Worker',
  worker_email: 'taylor@example.invalid',
  job_id: JOB_ID,
  job_name: 'Bridge works',
  job_number: 'JOB-100',
  date: '2026-10-06',
  start_time: '2026-10-05T20:00:00.000Z',
  finish_time: '2026-10-06T04:30:00.000Z',
  lunch_break_mins: 30,
  total_hours: 8,
  status: 'completed',
  notes: null,
  removed_at: null,
  ...overrides,
});
const periodRow = (overrides = {}) => ({
  id: PERIOD_ID,
  company_id: COMPANY_ID,
  worker_reference_id: USER_ID,
  worker_name: 'Taylor Worker',
  worker_email: 'taylor@example.invalid',
  period_start: RANGE.periodStart,
  period_end: RANGE.periodEnd,
  period_timezone: 'Australia/Sydney',
  status: 'open',
  ...overrides,
});

const createTableHarness = responses => {
  const calls = [];
  const from = table => {
    calls.push([table, 'from']);
    const query = {
      select(fields) { calls.push([table, 'select', fields]); return query; },
      eq(field, value) { calls.push([table, 'eq', field, value]); return query; },
      gte(field, value) { calls.push([table, 'gte', field, value]); return query; },
      lte(field, value) { calls.push([table, 'lte', field, value]); return query; },
      is(field, value) { calls.push([table, 'is', field, value]); return query; },
      order(field, options) { calls.push([table, 'order', field, options]); return query; },
      single() { calls.push([table, 'single']); return query; },
      then(resolve, reject) {
        const response = typeof responses[table] === 'function'
          ? responses[table](calls.filter(call => call[0] === table))
          : responses[table];
        return Promise.resolve(response).then(resolve, reject);
      },
    };
    return query;
  };
  return { calls, from };
};

const successfulHarness = ({ entries = [entryRow()], periods = [periodRow()] } = {}) => createTableHarness({
  companies: { data: companyRow, error: null },
  time_entries: { data: entries, error: null },
  timesheet_periods: { data: periods, error: null },
});

const readSource = relativePath => fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('worker self-service read uses configured pay week and explicit company, worker and date scope', async () => {
  const harness = successfulHarness();
  const result = await createTimesheetsReadAdapter(harness.from).listMine(workerScope, '2026-10-06');
  assert.equal(result.entries.length, 1);
  assert.deepEqual([result.period_start, result.period_end], ['2026-10-01', '2026-10-07']);
  assert.equal(result.periods[0].status, 'open');
  assert.ok(harness.calls.some(call => call[0] === 'time_entries' && call[1] === 'eq' && call[2] === 'worker_reference_id' && call[3] === USER_ID));
  assert.ok(harness.calls.some(call => call[0] === 'timesheet_periods' && call[1] === 'eq' && call[2] === 'worker_reference_id' && call[3] === USER_ID));
  assert.ok(harness.calls.some(call => call[0] === 'time_entries' && call[1] === 'is' && call[2] === 'removed_at' && call[3] === null));
});

test('worker cannot invoke company-wide Timesheets and no table query is attempted', async () => {
  const harness = createTableHarness({});
  await assert.rejects(
    () => createTimesheetsReadAdapter(harness.from).listCompany(workerScope, '2026-10-06'),
    error => error.code === '42501'
  );
  assert.deepEqual(harness.calls, []);
});

test('Owner and Admin company reads remain company/date scoped without a worker constraint', async () => {
  for (const role of ['owner', 'admin']) {
    const harness = successfulHarness();
    const result = await createTimesheetsReadAdapter(harness.from).listCompany({ ...adminScope, role }, '2026-10-06');
    assert.equal(result.entries[0].worker_reference_id, USER_ID);
    assert.ok(harness.calls.some(call => call[0] === 'time_entries' && call[1] === 'eq' && call[2] === 'company_id' && call[3] === COMPANY_ID));
    assert.equal(harness.calls.some(call => call[2] === 'worker_reference_id'), false);
  }
});

test('empty worker and administrative results remain empty without invented records', async () => {
  for (const method of ['listMine', 'listCompany']) {
    const harness = successfulHarness({ entries: [], periods: [] });
    const scope = method === 'listMine' ? workerScope : adminScope;
    const result = await createTimesheetsReadAdapter(harness.from)[method](scope, '2026-10-06');
    assert.deepEqual(result.entries, []);
    assert.deepEqual(result.periods, []);
    assert.equal(result.total_hours, 0);
  }
});

test('pay-week calculation supports native Thursday and Monday company settings', () => {
  assert.deepEqual(calculateTimesheetPayWeek('2026-10-06', 4), RANGE);
  assert.deepEqual(calculateTimesheetPayWeek('2026-10-06', 1), {
    periodStart: '2026-10-05',
    periodEnd: '2026-10-11',
  });
  assert.throws(() => calculateTimesheetPayWeek('2026-02-30', 4));
  assert.throws(() => calculateTimesheetPayWeek('2026-10-06', 0));
});

test('time-entry mapping preserves confirmed fields, timestamps, nullable Job data and manual distinction', () => {
  const mapped = mapTimeEntryRow(entryRow({
    job_id: null,
    job_name: null,
    job_number: null,
    finish_time: null,
    total_hours: null,
    status: 'active',
  }), COMPANY_ID, RANGE, USER_ID);
  assert.deepEqual(Object.keys(mapped), [
    'id', 'company_id', 'worker_reference_id', 'worker_name', 'worker_email', 'job_id', 'job_name',
    'job_number', 'date', 'start_time', 'finish_time', 'lunch_break_mins', 'total_hours', 'status',
    'notes', 'removed_at',
  ]);
  assert.equal(mapped.job_id, null);
  assert.equal(mapped.finish_time, null);
  assert.equal(mapped.total_hours, null);
  assert.equal(mapTimeEntryRow(entryRow({ status: 'manual' }), COMPANY_ID, RANGE).status, 'manual');
});

test('stored canonical hours exclude active records and are never re-derived from timestamps', () => {
  const entries = [
    mapTimeEntryRow(entryRow({ total_hours: '7.50' }), COMPANY_ID, RANGE),
    mapTimeEntryRow(entryRow({ id: '66666666-6666-4666-8666-666666666666', status: 'manual', total_hours: 2.25 }), COMPANY_ID, RANGE),
    mapTimeEntryRow(entryRow({ id: '77777777-7777-4777-8777-777777777777', status: 'active', finish_time: null, total_hours: null }), COMPANY_ID, RANGE),
  ];
  assert.equal(calculateStoredTimesheetHours(entries), 9.75);
});

test('open, submitted and approved period states map exactly', () => {
  for (const status of ['open', 'submitted', 'approved']) {
    assert.equal(mapTimesheetPeriodRow(periodRow({ status }), COMPANY_ID, RANGE).status, status);
  }
});

test('cross-company, cross-worker, removed and out-of-range records fail closed', () => {
  for (const row of [
    entryRow({ company_id: OTHER_COMPANY_ID }),
    entryRow({ worker_reference_id: OTHER_USER_ID }),
    entryRow({ removed_at: '2026-10-07T00:00:00Z' }),
    entryRow({ date: '2026-10-08' }),
  ]) assert.throws(() => mapTimeEntryRow(row, COMPANY_ID, RANGE, USER_ID));
  assert.throws(() => mapTimesheetPeriodRow(periodRow({ company_id: OTHER_COMPANY_ID }), COMPANY_ID, RANGE));
  assert.throws(() => mapTimesheetPeriodRow(periodRow({ worker_reference_id: OTHER_USER_ID }), COMPANY_ID, RANGE, USER_ID));
});

test('invalid enums, numeric fields, dates, timestamps and response rows are rejected', () => {
  for (const row of [
    entryRow({ status: 'approved' }),
    entryRow({ lunch_break_mins: null }),
    entryRow({ lunch_break_mins: -1 }),
    entryRow({ total_hours: '' }),
    entryRow({ total_hours: 'invalid' }),
    entryRow({ date: '2026-02-30' }),
    entryRow({ start_time: 'invalid' }),
    entryRow({ id: 'invalid' }),
  ]) assert.throws(() => mapTimeEntryRow(row, COMPANY_ID, RANGE));
  assert.throws(() => mapTimeEntryRow(null, COMPANY_ID, RANGE));
  assert.throws(() => mapTimesheetPeriodRow(periodRow({ status: 'finalised' }), COMPANY_ID, RANGE));
});

test('malformed query envelopes and backend failures propagate without unsafe fallback', async () => {
  for (const response of [
    { data: {}, error: null },
    { data: null, error: new Error('offline') },
  ]) {
    const harness = createTableHarness({
      companies: { data: companyRow, error: null },
      time_entries: response,
      timesheet_periods: { data: [], error: null },
    });
    await assert.rejects(() => createTimesheetsReadAdapter(harness.from).listMine(workerScope, '2026-10-06'));
  }
});

test('authentication, active workspace and matching membership are mandatory', () => {
  const company = { id: COMPANY_ID, name: 'Alpha' };
  const membership = { company_id: COMPANY_ID, user_id: USER_ID, role: 'worker' };
  assert.equal(resolveTimesheetReadScope({ userId: null, company, membership }), null);
  assert.equal(resolveTimesheetReadScope({ userId: USER_ID, company: null, membership }), null);
  assert.equal(resolveTimesheetReadScope({ userId: USER_ID, company, membership: null }), null);
  assert.equal(resolveTimesheetReadScope({ userId: USER_ID, company, membership: { ...membership, company_id: OTHER_COMPANY_ID } }), null);
  assert.equal(resolveTimesheetReadScope({ userId: ADMIN_ID, company, membership }), null);
});

test('approved roles resolve and historical supervisor normalizes to Worker', () => {
  const company = { id: COMPANY_ID, name: 'Alpha' };
  for (const role of ['owner', 'admin', 'worker', 'supervisor']) {
    const scope = resolveTimesheetReadScope({
      userId: USER_ID,
      company,
      membership: { company_id: COMPANY_ID, user_id: USER_ID, role },
    });
    assert.equal(scope.role, role === 'supervisor' ? 'worker' : role);
  }
  assert.equal(normalizeTimesheetRole('supervisor'), 'worker');
  assert.equal(canReadCompanyTimesheets(adminScope), true);
  assert.equal(canReadCompanyTimesheets(workerScope), false);
});

test('identity, workspace, role, view and date changes produce distinct request identities', () => {
  const base = createTimesheetRequestKey(workerScope, '2026-10-06', 'mine');
  assert.notEqual(base, createTimesheetRequestKey({ ...workerScope, userId: ADMIN_ID }, '2026-10-06', 'mine'));
  assert.notEqual(base, createTimesheetRequestKey({ ...workerScope, companyId: OTHER_COMPANY_ID }, '2026-10-06', 'mine'));
  assert.notEqual(base, createTimesheetRequestKey({ ...workerScope, role: 'admin' }, '2026-10-06', 'company'));
  assert.notEqual(base, createTimesheetRequestKey(workerScope, '2026-10-13', 'mine'));
  assert.equal(createTimesheetRequestKey(workerScope, '2026-10-06', 'company'), null);
});

test('Timesheets page hides stale data and discards late responses after scope or date changes', () => {
  const page = readSource('src/pages/Timesheets.jsx');
  assert.match(page, /resultRequestKey === requestKey/);
  assert.match(page, /hasCurrentResult \? result : null/);
  assert.match(page, /requestId !== requestIdRef\.current/);
  assert.match(page, /requestIdRef\.current \+= 1/);
  assert.match(page, /Previous-company time entries are hidden/);
  assert.match(page, /previous-account records are displayed/);
});

test('worker and administrative reads are separated and filters use confirmed identifiers', () => {
  const page = readSource('src/pages/Timesheets.jsx');
  assert.match(page, /timesheetsRead\.listCompany\(timesheetScope, anchorDate\)/);
  assert.match(page, /timesheetsRead\.listMine\(timesheetScope, anchorDate\)/);
  assert.match(page, /entry\.worker_reference_id === workerFilter/);
  assert.match(page, /entry\.job_id === jobFilter/);
  assert.match(page, /entry\.status === statusFilter/);
  assert.match(page, /No matching entries/);
  assert.match(page, /Company period states/);
  assert.match(page, /const period = periodByWorker\.get\(workerId\) \?\? null/);
  assert.match(page, /status: period\?\.status \?\? 'open'/);
});

test('Australian time presentation, read-only states and canonical stored totals are explicit', () => {
  const page = readSource('src/pages/Timesheets.jsx');
  assert.match(page, /timeZone: PERIOD_TIME_ZONE/);
  assert.match(page, /Australia\/Sydney/);
  assert.match(page, /Read only/);
  assert.match(page, /Recorded hours pending/);
  assert.match(page, /total_hours/);
  assert.equal(page.includes('finish_time - start_time'), false);
});

test('Timesheets read adapter remains mutation-free and the page excludes payroll, export and worker submission', () => {
  const readAdapter = readSource('src/api/supabase/timesheets-read-adapter.js').toLowerCase();
  const page = readSource('src/pages/Timesheets.jsx').toLowerCase();
  for (const token of [
    '.insert(', '.update(', '.delete(', '.upsert(', 'clockintimeentry', 'clockouttimeentry',
    'create_manual_time_entry', 'finalisetimesheet', 'reopentimesheet',
  ]) assert.equal(readAdapter.includes(token), false, token);
  for (const token of [
    'create_payroll_export', 'get_payroll_export', 'exportcsv', 'exportmyob', 'blob(',
    'download=', 'submit_my_timesheet_period',
  ]) assert.equal(page.includes(token), false, token);
});

test('dashboard and every prior W03 integration remain present', () => {
  assert.equal(DASHBOARD_MODULES.find(module => module.key === 'timesheets').path, '/timesheets');
  assert.deepEqual(Object.keys(JOB_FIRST_MODULES), [
    'pre-starts', 'toolbox-talks', 'site-diaries', 'site-photos', 'purchase-orders',
  ]);
  for (const moduleKey of Object.keys(JOB_FIRST_MODULES)) {
    assert.equal(getJobRecordsPath(moduleKey, JOB_ID), `/work/${moduleKey}/jobs/${JOB_ID}`);
  }
  const api = readSource('src/api/supabase/adapter.js');
  for (const moduleName of ['calendarRead:', 'equipmentRead:', 'jobs:', 'leaveRead:', 'profileRead:', 'teamDirectory:', 'timesheetsRead:', 'workspaces:']) {
    assert.match(api, new RegExp(moduleName));
  }
});
