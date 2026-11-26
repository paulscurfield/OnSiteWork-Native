import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createPayrollExportAdapter,
  createPayrollExportRequestManager,
  parsePayrollExportHistoryResponse,
} from '../../src/api/supabase/payroll-export-adapter.js';
import {
  createPayrollCsvModel,
  serializeJobLabourHoursCsv,
  serializeWeeklyTimesheetCsv,
} from '../../src/lib/payroll-csv.js';

const IDS = {
  user: '10000000-0000-4000-8000-000000000001',
  company: '10000000-0000-4000-8000-000000000002',
  otherCompany: '10000000-0000-4000-8000-000000000003',
  request: '10000000-0000-4000-8000-000000000004',
  retryRequest: '10000000-0000-4000-8000-000000000005',
  export: '10000000-0000-4000-8000-000000000006',
  export2: '10000000-0000-4000-8000-000000000007',
  export3: '10000000-0000-4000-8000-000000000008',
  worker: '20000000-0000-4000-8000-000000000001',
  period: '30000000-0000-4000-8000-000000000001',
  entry: '40000000-0000-4000-8000-000000000001',
  job: '50000000-0000-4000-8000-000000000001',
};

const context = (overrides = {}) => ({
  userId: IDS.user,
  companyId: IDS.company,
  role: 'admin',
  periodStart: '2026-11-23',
  periodEnd: '2026-11-29',
  contextVersion: 1,
  ...overrides,
});

const snapshot = (overrides = {}) => ({
  state: 'ready',
  export_id: IDS.export,
  request_id: IDS.request,
  version: 3,
  period_start: '2026-11-23',
  period_end: '2026-11-29',
  period_timezone: 'Australia/Sydney',
  created_at: '2026-11-30T01:02:03.456+00:00',
  worker_count: 1,
  row_count: 1,
  total_hours: '8.00',
  locked_period_ids: [IDS.period],
  snapshot_hash: 'a'.repeat(64),
  rows: [{
    entry_id: IDS.entry,
    worker_reference_id: IDS.worker,
    worker_name: 'Synthetic Worker',
    worker_email: 'synthetic@example.invalid',
    period_id: IDS.period,
    locked_at_utc: '2026-11-30T00:30:00.000000Z',
    work_date: '2026-11-24',
    start_time_utc: '2026-11-23T21:00:00.000000Z',
    finish_time_utc: '2026-11-24T05:30:00.000000Z',
    start_time_local: '2026-11-24T08:00:00.000000',
    finish_time_local: '2026-11-24T16:30:00.000000',
    period_timezone: 'Australia/Sydney',
    lunch_break_minutes: 30,
    total_hours: '8.00',
    worker_week_total_hours: '8.00',
    entry_status: 'completed',
    job_id: IDS.job,
    job_number: 'J-100',
    job_name: 'Synthetic Job',
  }],
  ...overrides,
});

const noData = () => ({
  state: 'no_data',
  period_start: '2026-11-23',
  period_end: '2026-11-29',
  period_timezone: 'Australia/Sydney',
});

const historyItem = (version, overrides = {}) => ({
  export_id: version === 3 ? IDS.export : version === 2 ? IDS.export2 : IDS.export3,
  version,
  created_at: `2026-11-${27 + version}T01:02:03.456+00:00`,
  period_timezone: 'Australia/Sydney',
  worker_count: 1,
  row_count: 1,
  total_hours: '8.00',
  snapshot_hash: String(version).repeat(64),
  has_newer_version: version < 3,
  ...overrides,
});

const history = (exports = [], nextBeforeVersion = null, overrides = {}) => ({
  state: 'ready',
  period_start: '2026-11-23',
  period_end: '2026-11-29',
  exports,
  next_before_version: nextBeforeVersion,
  ...overrides,
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

const createHarness = ({ handler, requestIds = [IDS.request, IDS.retryRequest] } = {}) => {
  const calls = [];
  let current = context();
  let userId = IDS.user;
  let workspace = { companyId: IDS.company, role: 'admin' };
  const ids = [...requestIds];
  const requestManager = createPayrollExportRequestManager(() => ids.shift());
  const rpc = async (name, params) => {
    calls.push([name, params]);
    if (!handler) throw new Error('Unexpected RPC call');
    return handler(name, params, calls.length);
  };
  const adapter = createPayrollExportAdapter(
    async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    async () => workspace,
    rpc,
    { requestManager },
  );

  return {
    adapter,
    calls,
    controller: () => adapter.forContext(current, () => current),
    getContext: () => current,
    setContext: value => { current = value; },
    setUserId: value => { userId = value; },
    setWorkspace: value => { workspace = value; },
  };
};

test('create uses exact RPC arguments and returns a frozen validated ready snapshot', async () => {
  const harness = createHarness({ handler: async () => ({ data: snapshot(), error: null }) });
  const controller = harness.controller();
  const request = controller.prepareCreate();
  const result = await controller.create(request);

  assert.deepEqual(harness.calls, [[
    'create_payroll_export_admin',
    { p_period_date: '2026-11-23', p_request_id: IDS.request },
  ]]);
  assert.equal(result.exportId, IDS.export);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.rows), true);
});

test('create accepts the documented exact no_data response without making it downloadable', async () => {
  const harness = createHarness({ handler: async () => ({ data: noData(), error: null }) });
  const controller = harness.controller();
  const result = await controller.create(controller.prepareCreate());
  assert.deepEqual(result, {
    state: 'no_data',
    periodStart: '2026-11-23',
    periodEnd: '2026-11-29',
    periodTimezone: 'Australia/Sydney',
  });
  assert.equal('rows' in result, false);
});

test('request tokens remain stable across controllers and explicit retries reuse the same UUID', async () => {
  let attempt = 0;
  const harness = createHarness({
    handler: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('Failed to fetch');
      return { data: snapshot(), error: null };
    },
  });
  const firstController = harness.controller();
  const request = firstController.prepareCreate();
  assert.strictEqual(harness.controller().prepareCreate(), request);

  await assert.rejects(() => firstController.create(request), error => error.code === 'NETWORK_UNCERTAIN');
  await assert.rejects(() => firstController.create(request), error => error.code === 'DUPLICATE_REQUEST');
  const result = await firstController.create(request, { retry: true });
  assert.equal(result.requestId, IDS.request);
  assert.deepEqual(harness.calls.map(([, params]) => params.p_request_id), [IDS.request, IDS.request]);
});

test('create never submits the same logical request concurrently', async () => {
  const pending = deferred();
  const harness = createHarness({ handler: async () => pending.promise });
  const controller = harness.controller();
  const request = controller.prepareCreate();
  const first = controller.create(request);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(
    () => harness.controller().create(request, { retry: true }),
    error => error.code === 'REQUEST_IN_FLIGHT',
  );
  pending.resolve({ data: snapshot(), error: null });
  await first;
  assert.equal(harness.calls.length, 1);
});

test('clearing a completed logical request permits a new UUID without storing payroll data', () => {
  const harness = createHarness();
  const controller = harness.controller();
  const first = controller.prepareCreate();
  assert.equal(controller.clearCreateRequest(first), true);
  const second = controller.prepareCreate();
  assert.equal(second.requestId, IDS.retryRequest);
  assert.deepEqual(Object.keys(second).sort(), [
    'companyId', 'periodEnd', 'periodStart', 'requestId', 'userId',
  ]);
});

test('invalid contexts, request UUIDs and request tokens fail before RPC', async () => {
  const harness = createHarness({ requestIds: ['not-a-uuid'] });
  assert.throws(() => harness.adapter.forContext(context({ periodEnd: '2026-11-30' }), () => context()));
  const controller = harness.controller();
  assert.throws(() => controller.prepareCreate(), error => error.code === '22023');
  await assert.rejects(
    () => controller.create(Object.freeze({ requestId: IDS.request })),
    error => error.code === '22023',
  );
  assert.equal(harness.calls.length, 0);
});

test('authorisation and malformed create responses fail closed with safe errors', async () => {
  const denied = createHarness({
    handler: async () => ({ data: null, error: { code: '42501', message: 'private detail' } }),
  });
  const deniedController = denied.controller();
  await assert.rejects(
    () => deniedController.create(deniedController.prepareCreate()),
    error => error.code === '42501' && !error.message.includes('private detail'),
  );

  const malformed = createHarness({ handler: async () => ({ data: { ...snapshot(), rows: [] }, error: null }) });
  const malformedController = malformed.controller();
  await assert.rejects(
    () => malformedController.create(malformedController.prepareCreate()),
    error => error.message === 'Payroll export response was invalid',
  );
});

test('list supports empty history and exact null-cursor RPC arguments', async () => {
  const harness = createHarness({ handler: async () => ({ data: history(), error: null }) });
  const result = await harness.controller().list();
  assert.deepEqual(result.exports, []);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(harness.calls, [[
    'list_payroll_exports_admin',
    { p_period_start: '2026-11-23', p_before_version: null, p_limit: 20 },
  ]]);
});

test('list validates newest-first versions and a progressing next cursor', async () => {
  const page = history([historyItem(3), historyItem(2)], 2);
  const harness = createHarness({ handler: async () => ({ data: page, error: null }) });
  const result = await harness.controller().list({ limit: 2 });
  assert.deepEqual(result.exports.map(item => item.version), [3, 2]);
  assert.equal(result.nextBeforeVersion, 2);
  assert.equal(result.exports[0].totalHoursHundredths, 800);
  assert.equal(Object.isFrozen(result.exports), true);
});

test('list supports an older metadata-only page without snapshot rows', async () => {
  const page = history([historyItem(1)], null);
  const harness = createHarness({ handler: async () => ({ data: page, error: null }) });
  const result = await harness.controller().list({ beforeVersion: 2, limit: 20 });
  assert.equal(result.exports[0].version, 1);
  assert.equal('rows' in result.exports[0], false);
  assert.deepEqual(harness.calls[0], [
    'list_payroll_exports_admin',
    { p_period_start: '2026-11-23', p_before_version: 2, p_limit: 20 },
  ]);
});

test('invalid history cursors and page sizes fail before RPC', async () => {
  const harness = createHarness();
  const controller = harness.controller();
  for (const options of [
    { beforeVersion: 0 },
    { beforeVersion: 1.5 },
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
  ]) {
    await assert.rejects(() => controller.list(options), error => error.code === '22023');
  }
  assert.equal(harness.calls.length, 0);
});

test('history rejects unexpected fields, wrong periods, duplicates, ordering and cursor defects', () => {
  const cases = [
    history([], null, { company_id: IDS.company }),
    history([], null, { period_start: '2026-11-16', period_end: '2026-11-22' }),
    history([historyItem(3), historyItem(3, { export_id: IDS.export2 })]),
    history([historyItem(3), historyItem(2, { export_id: IDS.export })]),
    history([historyItem(2), historyItem(3)]),
    history([historyItem(3), historyItem(2)], 3),
    history([historyItem(3)], 3),
    history([historyItem(3, { has_newer_version: true })]),
    history([historyItem(3, { rows: [] })]),
  ];
  for (const value of cases) {
    assert.throws(
      () => parsePayrollExportHistoryResponse(value, '2026-11-23', null, 2),
      error => error.code === 'INVALID_RESPONSE',
    );
  }
});

test('get retrieves and validates a historical snapshot without creating another export', async () => {
  const harness = createHarness({ handler: async () => ({ data: snapshot(), error: null }) });
  const result = await harness.controller().get(IDS.export);
  assert.equal(result.version, 3);
  assert.deepEqual(harness.calls, [[
    'get_payroll_export_admin',
    { p_export_id: IDS.export },
  ]]);
});

test('get rejects invalid IDs, unavailable exports and mismatched snapshots', async () => {
  const invalidId = createHarness();
  await assert.rejects(() => invalidId.controller().get('not-a-uuid'), error => error.code === '22023');
  assert.equal(invalidId.calls.length, 0);

  const unavailable = createHarness({
    handler: async () => ({ data: null, error: { code: 'P0002', message: 'Payroll export is unavailable' } }),
  });
  await assert.rejects(() => unavailable.controller().get(IDS.export), error => error.code === 'P0002');

  for (const payload of [
    snapshot({ export_id: IDS.export2 }),
    snapshot({ period_start: '2026-11-16', period_end: '2026-11-22' }),
    { ...snapshot(), unexpected: true },
  ]) {
    const harness = createHarness({ handler: async () => ({ data: payload, error: null }) });
    await assert.rejects(() => harness.controller().get(IDS.export), error => error.code === 'INVALID_RESPONSE');
  }
});

test('missing authentication, workspace and Worker role deny access before payroll RPC', async () => {
  const signedOut = createHarness();
  signedOut.setUserId(null);
  await assert.rejects(() => signedOut.controller().list(), error => error.code === '42501');

  const missingWorkspace = createHarness();
  missingWorkspace.setWorkspace(null);
  await assert.rejects(() => missingWorkspace.controller().list(), error => error.code === '42501');

  const worker = createHarness();
  assert.throws(
    () => worker.adapter.forContext(context({ role: 'worker' }), () => context({ role: 'worker' })),
    error => error.code === '42501',
  );
  assert.equal(signedOut.calls.length + missingWorkspace.calls.length + worker.calls.length, 0);
});

test('company, role, sign-out and pay-week changes while pending reject the stale result', async () => {
  for (const change of [
    harness => harness.setContext(context({ companyId: IDS.otherCompany, contextVersion: 2 })),
    harness => harness.setWorkspace({ companyId: IDS.company, role: 'worker' }),
    harness => harness.setUserId(null),
    harness => harness.setContext(context({
      periodStart: '2026-11-30',
      periodEnd: '2026-12-06',
      contextVersion: 2,
    })),
  ]) {
    const pending = deferred();
    const harness = createHarness({ handler: async () => pending.promise });
    const operation = harness.controller().list();
    await new Promise(resolve => setImmediate(resolve));
    change(harness);
    pending.resolve({ data: history(), error: null });
    await assert.rejects(
      () => operation,
      error => error.code === 'STALE_CONTEXT' || error.code === '42501',
    );
  }
});

test('out-of-order history and export responses are rejected', async () => {
  for (const method of ['list', 'get']) {
    const first = deferred();
    const second = deferred();
    let call = 0;
    const harness = createHarness({
      handler: async () => {
        call += 1;
        return call === 1 ? first.promise : second.promise;
      },
    });
    const olderController = harness.controller();
    const newerController = harness.controller();
    const older = method === 'list' ? olderController.list() : olderController.get(IDS.export);
    const newer = method === 'list' ? newerController.list() : newerController.get(IDS.export);
    await new Promise(resolve => setImmediate(resolve));
    second.resolve({ data: method === 'list' ? history() : snapshot(), error: null });
    await newer;
    first.resolve({ data: method === 'list' ? history() : snapshot(), error: null });
    await assert.rejects(() => older, error => error.code === 'STALE_CONTEXT');
  }
});

test('retrieved immutable snapshots feed both CSV reports without create RPCs', async () => {
  const harness = createHarness({ handler: async () => ({ data: snapshot(), error: null }) });
  const retrieved = await harness.controller().get(IDS.export);
  const model = createPayrollCsvModel(retrieved);
  assert.match(serializeWeeklyTimesheetCsv(model), /Weekly Timesheet/u);
  assert.match(serializeJobLabourHoursCsv(model), /Job Labour Hours/u);
  assert.deepEqual(harness.calls.map(([name]) => name), ['get_payroll_export_admin']);
});

test('adapter source has no service-role key, direct payroll table read, payload log or hidden retry', () => {
  const source = fs.readFileSync(
    new URL('../../src/api/supabase/payroll-export-adapter.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /service[_-]?role|from\(['"]payroll_exports|console\.|localStorage/iu);
  assert.doesNotMatch(source, /while\s*\(|setInterval|setTimeout/iu);
  assert.match(source, /create_payroll_export_admin/u);
  assert.match(source, /list_payroll_exports_admin/u);
  assert.match(source, /get_payroll_export_admin/u);
});

test('central registration reuses the existing client and preserves Timesheets administration', () => {
  const source = fs.readFileSync(
    new URL('../../src/api/supabase/adapter.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /payrollExports:\s*createPayrollExportAdapter/u);
  assert.match(source, /timesheetsAdmin:\s*createTimesheetsAdminAdapter/u);
  assert.doesNotMatch(source, /createClient\s*\(/u);
});
