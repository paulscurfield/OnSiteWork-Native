import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createLeaveReadAdapter,
  mapAdminLeaveRequest,
  mapLeaveRequest,
} from '../../src/api/supabase/leave-read-adapter.js';
import {
  canReadCompanyLeave,
  createLeaveScopeKey,
  normalizeLeaveRole,
  resolveLeaveReadScope,
} from '../../src/lib/leave-access.js';
import {
  DASHBOARD_MODULES,
  getJobRecordsPath,
  JOB_FIRST_MODULES,
} from '../../src/navigation/dashboard-modules.js';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

const workerScope = { userId: USER_ID, companyId: COMPANY_ID, companyName: 'Alpha', role: 'worker' };
const adminScope = { userId: ADMIN_ID, companyId: COMPANY_ID, companyName: 'Alpha', role: 'admin' };
const leaveRow = (overrides = {}) => ({
  id: REQUEST_ID,
  company_id: COMPANY_ID,
  leave_type: 'annual',
  start_date: '2026-12-01',
  end_date: '2026-12-03',
  notes: null,
  status: 'pending',
  created_at: '2026-11-19T01:00:00Z',
  reviewed_at: null,
  ...overrides,
});

const createRpcHarness = responses => {
  const calls = [];
  return {
    calls,
    async rpc(name, params) {
      calls.push([name, params]);
      const response = responses[name];
      return typeof response === 'function' ? response(params) : response;
    },
  };
};

const readSource = relativePath => fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('personal Leave uses only get_my_leave_requests with the active company', async () => {
  const harness = createRpcHarness({
    get_my_leave_requests: { data: { leave_requests: [leaveRow()] }, error: null },
  });
  const requests = await createLeaveReadAdapter(harness.rpc).listMine(workerScope);
  assert.deepEqual(requests, [leaveRow()]);
  assert.deepEqual(harness.calls, [['get_my_leave_requests', { p_company_id: COMPANY_ID }]]);
});

test('empty personal Leave results remain empty without fabricated balances', async () => {
  const harness = createRpcHarness({
    get_my_leave_requests: { data: { leave_requests: [] }, error: null },
  });
  assert.deepEqual(await createLeaveReadAdapter(harness.rpc).listMine(workerScope), []);
  assert.equal(Object.hasOwn(mapLeaveRequest(leaveRow(), COMPANY_ID), 'balance'), false);
  assert.equal(Object.hasOwn(mapLeaveRequest(leaveRow(), COMPANY_ID), 'duration'), false);
});

test('Owner and Admin company Leave uses only the approved administrative RPC', async () => {
  for (const role of ['owner', 'admin']) {
    const harness = createRpcHarness({
      get_company_leave_requests_admin: {
        data: { leave_requests: [leaveRow({ worker_name: 'Taylor Worker' })] },
        error: null,
      },
    });
    const requests = await createLeaveReadAdapter(harness.rpc).listCompany({ ...adminScope, role });
    assert.equal(requests[0].worker_name, 'Taylor Worker');
    assert.deepEqual(harness.calls, [[
      'get_company_leave_requests_admin',
      { p_company_id: COMPANY_ID },
    ]]);
  }
});

test('empty administrative Leave results remain empty', async () => {
  const harness = createRpcHarness({
    get_company_leave_requests_admin: { data: { leave_requests: [] }, error: null },
  });
  assert.deepEqual(await createLeaveReadAdapter(harness.rpc).listCompany(adminScope), []);
});

test('worker administrative access is denied before any RPC call', async () => {
  const harness = createRpcHarness({});
  await assert.rejects(
    () => createLeaveReadAdapter(harness.rpc).listCompany(workerScope),
    error => error.code === '42501'
  );
  assert.deepEqual(harness.calls, []);
});

test('RPC permission denials and backend failures propagate without direct-table fallback', async () => {
  for (const error of [
    Object.assign(new Error('Active company membership required'), { code: '42501' }),
    new Error('offline'),
  ]) {
    const harness = createRpcHarness({ get_my_leave_requests: { data: null, error } });
    await assert.rejects(() => createLeaveReadAdapter(harness.rpc).listMine(workerScope), candidate => candidate === error);
  }
});

test('Leave mapping validates UUID, company, dates, type, status and timestamps', () => {
  const invalidRows = [
    leaveRow({ id: 'invalid' }),
    leaveRow({ company_id: OTHER_COMPANY_ID }),
    leaveRow({ leave_type: 'bereavement' }),
    leaveRow({ status: 'cancelled' }),
    leaveRow({ start_date: '2026-02-30' }),
    leaveRow({ end_date: '2026-11-30' }),
    leaveRow({ created_at: 'not-a-time' }),
    leaveRow({ reviewed_at: 'not-a-time' }),
  ];
  for (const row of invalidRows) assert.throws(() => mapLeaveRequest(row, COMPANY_ID));
  assert.throws(() => mapLeaveRequest(null, COMPANY_ID), /invalid request/);
});

test('malformed RPC envelopes and records fail closed', async () => {
  for (const data of [null, [], {}, { leave_requests: {} }, { leave_requests: [null] }]) {
    const harness = createRpcHarness({ get_my_leave_requests: { data, error: null } });
    await assert.rejects(() => createLeaveReadAdapter(harness.rpc).listMine(workerScope));
  }
});

test('supported fields map exactly and nullable values remain null', () => {
  const mapped = mapLeaveRequest(leaveRow({ leave_type: 'sick', status: 'approved' }), COMPANY_ID);
  assert.deepEqual(Object.keys(mapped), [
    'id', 'company_id', 'leave_type', 'start_date', 'end_date', 'notes', 'status', 'created_at', 'reviewed_at',
  ]);
  assert.equal(mapped.leave_type, 'sick');
  assert.equal(mapped.status, 'approved');
  assert.equal(mapped.notes, null);
  assert.equal(mapped.reviewed_at, null);
});

test('administrative worker names are privacy-sanitized and never expose worker email', () => {
  assert.equal(mapAdminLeaveRequest(leaveRow({ worker_name: 'worker@example.invalid' }), COMPANY_ID).worker_name, 'Employee');
  assert.equal(mapAdminLeaveRequest(leaveRow({ worker_name: 'Taylor Worker' }), COMPANY_ID).worker_name, 'Taylor Worker');
  assert.equal(Object.hasOwn(mapAdminLeaveRequest(leaveRow({ worker_name: 'Taylor Worker', worker_email: 'private@example.invalid' }), COMPANY_ID), 'worker_email'), false);
});

test('authentication, workspace and membership are all required for a Leave scope', () => {
  const company = { id: COMPANY_ID, name: 'Alpha' };
  const membership = { company_id: COMPANY_ID, user_id: USER_ID, role: 'worker' };
  assert.equal(resolveLeaveReadScope({ userId: null, company, membership }), null);
  assert.equal(resolveLeaveReadScope({ userId: USER_ID, company: null, membership }), null);
  assert.equal(resolveLeaveReadScope({ userId: USER_ID, company, membership: null }), null);
  assert.equal(resolveLeaveReadScope({ userId: USER_ID, company, membership: { ...membership, company_id: OTHER_COMPANY_ID } }), null);
  assert.equal(resolveLeaveReadScope({ userId: ADMIN_ID, company, membership }), null);
});

test('approved roles resolve and historical supervisor normalizes to Worker', () => {
  const company = { id: COMPANY_ID, name: 'Alpha' };
  for (const role of ['owner', 'admin', 'worker', 'supervisor']) {
    const scope = resolveLeaveReadScope({
      userId: USER_ID,
      company,
      membership: { company_id: COMPANY_ID, user_id: USER_ID, role },
    });
    assert.equal(scope.role, role === 'supervisor' ? 'worker' : role);
  }
  assert.equal(normalizeLeaveRole('supervisor'), 'worker');
  assert.equal(canReadCompanyLeave(adminScope), true);
  assert.equal(canReadCompanyLeave(workerScope), false);
});

test('identity, workspace and role changes produce distinct Leave request identities', () => {
  assert.notEqual(createLeaveScopeKey(workerScope), createLeaveScopeKey({ ...workerScope, userId: ADMIN_ID }));
  assert.notEqual(createLeaveScopeKey(workerScope), createLeaveScopeKey({ ...workerScope, companyId: OTHER_COMPANY_ID }));
  assert.notEqual(createLeaveScopeKey(workerScope), createLeaveScopeKey({ ...workerScope, role: 'admin' }));
  assert.equal(createLeaveScopeKey(null), null);
});

test('Leave page hides stale records and discards late responses', () => {
  const page = readSource('src/pages/Leave.jsx');
  assert.match(page, /resolveLeaveReadScope/);
  assert.match(page, /resultScopeKey === leaveScopeKey/);
  assert.match(page, /hasCurrentResult \? personalRequests : \[\]/);
  assert.match(page, /hasCurrentResult \? companyRequests : \[\]/);
  assert.match(page, /requestId !== requestIdRef\.current/);
  assert.match(page, /requestIdRef\.current \+= 1/);
  assert.match(page, /No previous-company information is displayed/);
  assert.match(page, /No previous-account information is displayed/);
});

test('Leave page separates personal and company views and does not retry denied admin reads insecurely', () => {
  const page = readSource('src/pages/Leave.jsx');
  assert.match(page, /My leave requests/);
  assert.match(page, /Company leave overview/);
  assert.match(page, /onsiteApi\.leaveRead\.listMine\(leaveScope\)/);
  assert.match(page, /onsiteApi\.leaveRead\.listCompany\(leaveScope\)/);
  assert.match(page, /No direct-table fallback was attempted/);
  assert.equal(page.includes("from('leave_requests')"), false);
});

test('Leave integration exposes no mutation, attachment, balance or unsupported workflow controls', () => {
  const page = readSource('src/pages/Leave.jsx');
  const adapter = readSource('src/api/supabase/leave-read-adapter.js');
  const combined = `${page}\n${adapter}`.toLowerCase();
  for (const token of [
    '.insert(', '.update(', '.delete(', '.upload(', 'createleaverequest', 'reviewleaverequest',
    'cancelleaverequest', 'attachment', 'accrual', 'balance', 'half_day',
  ]) assert.equal(combined.includes(token), false, token);
  assert.equal(page.includes('<button'), false);
});

test('dashboard and prior W03 integrations remain intact', () => {
  assert.equal(DASHBOARD_MODULES.find(module => module.key === 'leave').path, '/leave');
  assert.deepEqual(Object.keys(JOB_FIRST_MODULES), [
    'pre-starts', 'toolbox-talks', 'site-diaries', 'site-photos', 'purchase-orders',
  ]);
  for (const moduleKey of Object.keys(JOB_FIRST_MODULES)) {
    assert.equal(getJobRecordsPath(moduleKey, REQUEST_ID), `/work/${moduleKey}/jobs/${REQUEST_ID}`);
  }
  const adapter = readSource('src/api/supabase/adapter.js');
  assert.match(adapter, /equipmentRead:/);
  assert.match(adapter, /jobs:/);
  assert.match(adapter, /profileRead:/);
  assert.match(adapter, /teamDirectory:/);
  assert.match(adapter, /workspaces:/);
});
