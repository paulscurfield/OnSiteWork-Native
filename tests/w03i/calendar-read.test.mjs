import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createCalendarReadAdapter,
  mapCalendarEvent,
  validateCalendarRange,
} from '../../src/api/supabase/calendar-read-adapter.js';
import {
  createCalendarRequestKey,
  normalizeCalendarRole,
  resolveCalendarReadScope,
} from '../../src/lib/calendar-access.js';
import {
  DASHBOARD_MODULES,
  getJobRecordsPath,
  JOB_FIRST_MODULES,
} from '../../src/navigation/dashboard-modules.js';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '44444444-4444-4444-8444-444444444444';

const workerScope = { userId: USER_ID, companyId: COMPANY_ID, companyName: 'Alpha', role: 'worker' };
const adminScope = { userId: ADMIN_ID, companyId: COMPANY_ID, companyName: 'Alpha', role: 'admin' };
const eventRow = (overrides = {}) => ({
  id: EVENT_ID,
  company_id: COMPANY_ID,
  job_id: JOB_ID,
  title: 'Site inspection',
  job_name: 'Bridge works',
  job_number: 'JOB-100',
  start_date: '2026-11-20',
  end_date: '2026-11-21',
  color: '#10B981',
  notes: 'Admin scheduling note',
  source_type: 'manual',
  created_at: '2026-11-19T01:00:00Z',
  updated_at: '2026-11-19T02:00:00Z',
  ...overrides,
});

const createRpcHarness = response => {
  const calls = [];
  return {
    calls,
    async rpc(...args) {
      calls.push(args);
      return response;
    },
  };
};

const readSource = relativePath => fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('Owner and Admin Calendar reads use the exact approved RPC and range arguments', async () => {
  for (const role of ['owner', 'admin']) {
    const harness = createRpcHarness({ data: { events: [eventRow()] }, error: null });
    const events = await createCalendarReadAdapter(harness.rpc).list({ ...adminScope, role }, '2026-11-01', '2026-11-30');
    assert.equal(events[0].notes, 'Admin scheduling note');
    assert.deepEqual(harness.calls, [[
      'get_calendar_events',
      {
        p_company_id: COMPANY_ID,
        p_start_date: '2026-11-01',
        p_end_date: '2026-11-30',
      },
    ]]);
  }
});

test('Worker Calendar read uses the same privacy-projecting RPC and suppresses manual notes', async () => {
  const harness = createRpcHarness({ data: { events: [eventRow()] }, error: null });
  const events = await createCalendarReadAdapter(harness.rpc).list(workerScope, '2026-11-01', '2026-11-30');
  assert.equal(events[0].notes, null);
  assert.equal(events[0].job_name, 'Bridge works');
  assert.equal(harness.calls[0][0], 'get_calendar_events');
});

test('empty Calendar event ranges remain empty', async () => {
  const harness = createRpcHarness({ data: { events: [] }, error: null });
  assert.deepEqual(await createCalendarReadAdapter(harness.rpc).list(workerScope, '2026-11-01', '2026-11-30'), []);
});

test('invalid and oversized date ranges fail before the RPC call', async () => {
  const harness = createRpcHarness({ data: { events: [] }, error: null });
  const adapter = createCalendarReadAdapter(harness.rpc);
  for (const range of [
    ['2026-02-30', '2026-03-01'],
    ['2026-11-30', '2026-11-01'],
    ['2026-01-01', '2027-01-07'],
    ['', '2026-11-30'],
  ]) await assert.rejects(() => adapter.list(workerScope, ...range));
  assert.deepEqual(harness.calls, []);
  assert.deepEqual(validateCalendarRange('2026-01-01', '2027-01-06'), {
    startDate: '2026-01-01',
    endDate: '2027-01-06',
  });
});

test('malformed Calendar envelopes and records fail closed', async () => {
  for (const data of [null, [], {}, { events: {} }, { events: [null] }]) {
    const adapter = createCalendarReadAdapter(createRpcHarness({ data, error: null }).rpc);
    await assert.rejects(() => adapter.list(workerScope, '2026-11-01', '2026-11-30'));
  }
});

test('RPC permission denial and backend failure propagate without fallback', async () => {
  for (const error of [
    Object.assign(new Error('Active company membership required'), { code: '42501' }),
    new Error('offline'),
  ]) {
    const adapter = createCalendarReadAdapter(createRpcHarness({ data: null, error }).rpc);
    await assert.rejects(() => adapter.list(workerScope, '2026-11-01', '2026-11-30'), candidate => candidate === error);
  }
});

test('confirmed Calendar fields map exactly with source type but no fabricated status or assignments', () => {
  const mapped = mapCalendarEvent(eventRow({ color: '#10b981' }), COMPANY_ID, 'admin');
  assert.deepEqual(Object.keys(mapped), [
    'id', 'company_id', 'job_id', 'title', 'job_name', 'job_number', 'start_date', 'end_date',
    'color', 'notes', 'source_type', 'created_at', 'updated_at',
  ]);
  assert.equal(mapped.color, '#10B981');
  assert.equal(mapped.source_type, 'manual');
  assert.equal(Object.hasOwn(mapped, 'status'), false);
  assert.equal(Object.hasOwn(mapped, 'assigned_user_ids'), false);
  assert.equal(Object.hasOwn(mapped, 'start_time'), false);
});

test('nullable job fields are preserved for manual events', () => {
  const mapped = mapCalendarEvent(eventRow({ job_id: null, job_name: null, job_number: null }), COMPANY_ID, 'owner');
  assert.equal(mapped.job_id, null);
  assert.equal(mapped.job_name, null);
  assert.equal(mapped.job_number, null);
});

test('approved Leave projection exposes availability only and strips private fields for every role', () => {
  for (const role of ['worker', 'admin', 'owner']) {
    const mapped = mapCalendarEvent(eventRow({
      source_type: 'leave',
      title: 'worker@example.invalid — On Leave',
      job_id: JOB_ID,
      job_name: 'Private leave reason',
      job_number: 'MEDICAL',
      notes: 'Confidential leave note',
      worker_email: 'worker@example.invalid',
      attachments: ['private.pdf'],
    }), COMPANY_ID, role);
    assert.equal(mapped.title, 'Employee on Leave');
    assert.equal(mapped.job_id, null);
    assert.equal(mapped.job_name, null);
    assert.equal(mapped.job_number, null);
    assert.equal(mapped.notes, null);
    assert.equal(Object.hasOwn(mapped, 'worker_email'), false);
    assert.equal(Object.hasOwn(mapped, 'attachments'), false);
  }
});

test('malformed event type, scope, dates, colors and timestamps are rejected', () => {
  for (const row of [
    eventRow({ company_id: OTHER_COMPANY_ID }),
    eventRow({ source_type: 'shift' }),
    eventRow({ start_date: '2026-02-30' }),
    eventRow({ end_date: '2026-11-01' }),
    eventRow({ color: 'green' }),
    eventRow({ updated_at: 'invalid' }),
    eventRow({ id: 'invalid' }),
  ]) assert.throws(() => mapCalendarEvent(row, COMPANY_ID, 'worker'));
});

test('authentication and a matching active workspace membership are required', () => {
  const company = { id: COMPANY_ID, name: 'Alpha' };
  const membership = { company_id: COMPANY_ID, user_id: USER_ID, role: 'worker' };
  assert.equal(resolveCalendarReadScope({ userId: null, company, membership }), null);
  assert.equal(resolveCalendarReadScope({ userId: USER_ID, company: null, membership }), null);
  assert.equal(resolveCalendarReadScope({ userId: USER_ID, company, membership: null }), null);
  assert.equal(resolveCalendarReadScope({ userId: USER_ID, company, membership: { ...membership, company_id: OTHER_COMPANY_ID } }), null);
  assert.equal(resolveCalendarReadScope({ userId: ADMIN_ID, company, membership }), null);
});

test('Owner, Admin and Worker roles resolve while historical supervisor normalizes to Worker', () => {
  const company = { id: COMPANY_ID, name: 'Alpha' };
  for (const role of ['owner', 'admin', 'worker', 'supervisor']) {
    const scope = resolveCalendarReadScope({
      userId: USER_ID,
      company,
      membership: { company_id: COMPANY_ID, user_id: USER_ID, role },
    });
    assert.equal(scope.role, role === 'supervisor' ? 'worker' : role);
  }
  assert.equal(normalizeCalendarRole('supervisor'), 'worker');
});

test('workspace, identity, role and date changes produce distinct Calendar request identities', () => {
  const base = createCalendarRequestKey(workerScope, '2026-11-01', '2026-11-30');
  assert.notEqual(base, createCalendarRequestKey({ ...workerScope, userId: ADMIN_ID }, '2026-11-01', '2026-11-30'));
  assert.notEqual(base, createCalendarRequestKey({ ...workerScope, companyId: OTHER_COMPANY_ID }, '2026-11-01', '2026-11-30'));
  assert.notEqual(base, createCalendarRequestKey({ ...workerScope, role: 'admin' }, '2026-11-01', '2026-11-30'));
  assert.notEqual(base, createCalendarRequestKey(workerScope, '2026-12-01', '2026-12-31'));
  assert.equal(createCalendarRequestKey(null, '2026-11-01', '2026-11-30'), null);
  assert.equal(createCalendarRequestKey(workerScope, '2026-11-30', '2026-11-01'), null);
});

test('Calendar page hides stale data and rejects late responses after scope or range changes', () => {
  const page = readSource('src/pages/Calendar.jsx');
  assert.match(page, /resultRequestKey === requestKey/);
  assert.match(page, /hasCurrentResult \? events : \[\]/);
  assert.match(page, /requestId !== requestIdRef\.current/);
  assert.match(page, /requestIdRef\.current \+= 1/);
  assert.match(page, /range\.startDate/);
  assert.match(page, /range\.endDate/);
  assert.match(page, /No previous-company events are displayed/);
});

test('Calendar page uses only the approved RPC adapter and preserves role-aware privacy', () => {
  const page = readSource('src/pages/Calendar.jsx');
  const adapter = readSource('src/api/supabase/calendar-read-adapter.js');
  assert.match(page, /onsiteApi\.calendarRead\.list\(calendarScope, range\.startDate, range\.endDate\)/);
  assert.match(page, /Team availability/);
  assert.match(page, /showNotes=\{calendarScope\.role === 'owner' \|\| calendarScope\.role === 'admin'\}/);
  assert.equal(page.includes("from('job_schedules')"), false);
  assert.equal(adapter.includes("from('job_schedules')"), false);
});

test('Calendar integration contains no reachable event mutation or assignment lookup', () => {
  const combined = `${readSource('src/pages/Calendar.jsx')}\n${readSource('src/api/supabase/calendar-read-adapter.js')}`;
  for (const token of [
    '.insert(', '.update(', '.delete(', 'create_calendar_event_admin', 'update_calendar_event_admin',
    'delete_calendar_event_admin', 'job_schedule_assignments', 'companyMembers.directory', 'Add schedule',
    'Edit schedule', 'Delete schedule',
  ]) assert.equal(combined.includes(token), false, token);
});

test('Leave, Jobs, Team, dashboard and job-first navigation remain intact', () => {
  assert.equal(DASHBOARD_MODULES.find(module => module.key === 'calendar').path, '/calendar');
  assert.equal(DASHBOARD_MODULES.find(module => module.key === 'leave').path, '/leave');
  assert.deepEqual(Object.keys(JOB_FIRST_MODULES), [
    'pre-starts', 'toolbox-talks', 'site-diaries', 'site-photos', 'purchase-orders',
  ]);
  for (const moduleKey of Object.keys(JOB_FIRST_MODULES)) {
    assert.equal(getJobRecordsPath(moduleKey, JOB_ID), `/work/${moduleKey}/jobs/${JOB_ID}`);
  }
  const api = readSource('src/api/supabase/adapter.js');
  assert.match(api, /leaveRead:/);
  assert.match(api, /jobs:/);
  assert.match(api, /teamDirectory:/);
  assert.match(readSource('src/pages/Leave.jsx'), /onsiteApi\.leaveRead\.listMine/);
});
