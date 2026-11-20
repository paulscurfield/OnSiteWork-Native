import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createSiteDiariesReadAdapter,
  mapSiteDiaryDeliveries,
  mapSiteDiaryRecord,
} from '../../src/api/supabase/site-diaries-read-adapter.js';
import {
  createSiteDiaryRequestKey,
  createSiteDiaryScopeKey,
  isSiteDiaryPermissionError,
  resolveSiteDiaryReadScope,
} from '../../src/lib/site-diary-access.js';
import { JOB_FIRST_MODULES } from '../../src/navigation/dashboard-modules.js';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_JOB_ID = '44444444-4444-4444-8444-444444444444';
const DIARY_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_DIARY_ID = '66666666-6666-4666-8666-666666666666';
const EQUIPMENT_ID = '77777777-7777-4777-8777-777777777777';
const TALK_ID = '88888888-8888-4888-8888-888888888888';
const DELIVERY_ID = '99999999-9999-4999-8999-999999999999';
const PHOTO_ID = '10101010-1010-4010-8010-101010101010';

const scope = (role = 'worker') => ({
  userId: USER_ID,
  companyId: COMPANY_ID,
  companyName: 'TEST Company',
  role,
  jobId: JOB_ID,
  jobName: 'TEST Harbour Job',
  jobNumber: 'JOB-001',
});

const summary = (overrides = {}) => ({
  id: DIARY_ID,
  local_date: '2026-11-20',
  status: 'draft',
  is_primary: true,
  owner_id: USER_ID,
  completed_at: null,
  updated_at: '2026-11-20T02:00:00.000Z',
  revision: 0,
  ...overrides,
});

const diaryPayload = (overrides = {}) => ({
  site_diary: {
    id: DIARY_ID,
    company_id: COMPANY_ID,
    job_id: JOB_ID,
    local_date: '2026-11-20',
    local_timezone: 'Australia/Sydney',
    status: 'draft',
    is_primary: true,
    owner_id: USER_ID,
    submitted_by_id: null,
    work_completed_today: ' Installed TEST formwork. ',
    weather_conditions: ' Fine ',
    workers_on_site: [{
      kind: 'member',
      member_user_id: USER_ID,
      display_name: ' TEST Worker ',
      source_toolbox_talk_ids: [TALK_ID],
    }],
    equipment_used: [{
      equipment_id: EQUIPMENT_ID,
      name: ' TEST Excavator ',
      identifier: ' EX-001 ',
      category: ' machinery ',
      source_toolbox_talk_ids: [TALK_ID],
    }],
    materials_used: ' TEST concrete ',
    visitors_inspections: '',
    incidents_near_misses: '',
    delays_issues: ' None ',
    general_notes: ' TEST notes ',
    toolbox_imported_at: '2026-11-20T00:30:00.000Z',
    revision: 0,
    completed_at: null,
    corrected_at: null,
    corrected_by_id: null,
    created_at: '2026-11-20T00:00:00.000Z',
    updated_at: '2026-11-20T02:00:00.000Z',
    ...overrides,
  },
});

const deliveriesPayload = (overrides = {}) => ({
  deliveries: [{
    id: DELIVERY_ID,
    local_date: '2026-11-20',
    delivered_at: '2026-11-20T01:00:00.000Z',
    created_by_id: USER_ID,
    created_by_display_name: ' TEST Recorder ',
    item_description: ' TEST aggregate ',
    quantity: ' 4 tonnes ',
    supplier: ' TEST Supplier ',
    notes: ' Gate two ',
    photo_ids: [PHOTO_ID],
    ...overrides,
  }],
});

const createRpcHarness = ({
  listData,
  listError = null,
  diaryData,
  diaryError = null,
  deliveryData,
  deliveryError = null,
} = {}) => {
  const calls = [];
  return {
    calls,
    async rpc(name, params) {
      calls.push([name, params]);
      if (name === 'list_job_site_diaries') {
        return { data: listData ?? { site_diaries: [summary()], page_size: 20 }, error: listError };
      }
      if (name === 'get_site_diary') {
        return { data: diaryData ?? diaryPayload(), error: diaryError };
      }
      if (name === 'list_site_diary_deliveries_v2') {
        return { data: deliveryData ?? deliveriesPayload(), error: deliveryError };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
};

const jobScope = (role = 'worker') => ({
  userId: USER_ID,
  companyId: COMPANY_ID,
  companyName: 'TEST Company',
  role,
});

const job = (overrides = {}) => ({
  id: JOB_ID,
  company_id: COMPANY_ID,
  job_name: 'TEST Harbour Job',
  job_number: 'JOB-001',
  ...overrides,
});

const readSource = relativePath => fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('listing uses only the committed company-and-Job Site Diary RPC', async () => {
  const harness = createRpcHarness();
  const diaries = await createSiteDiariesReadAdapter(harness.rpc).list(scope());
  assert.deepEqual(harness.calls, [[
    'list_job_site_diaries',
    {
      p_company_id: COMPANY_ID,
      p_job_id: JOB_ID,
      p_before_local_date: null,
      p_before_id: null,
    },
  ]]);
  assert.deepEqual(diaries, [{
    id: DIARY_ID,
    local_date: '2026-11-20',
    status: 'draft',
    is_primary: true,
    owner_id: USER_ID,
    completed_at: null,
    revision: 0,
    updated_at: '2026-11-20T02:00:00.000Z',
  }]);
});

test('missing identity, company, approved role or verified Job fails before an RPC', async () => {
  const harness = createRpcHarness();
  const adapter = createSiteDiariesReadAdapter(harness.rpc);
  for (const candidate of [
    null,
    { ...scope(), userId: '' },
    { ...scope(), companyId: 'bad' },
    { ...scope(), jobId: 'bad' },
    { ...scope(), role: 'supervisor' },
  ]) await assert.rejects(() => adapter.list(candidate));
  assert.deepEqual(harness.calls, []);
});

test('Worker, Admin and Owner use the same job-scoped diary history contract', async () => {
  for (const role of ['worker', 'admin', 'owner']) {
    const harness = createRpcHarness();
    assert.equal((await createSiteDiariesReadAdapter(harness.rpc).list(scope(role))).length, 1);
    assert.equal(harness.calls[0][0], 'list_job_site_diaries');
  }
});

test('empty history stays empty and backend failure propagates without fallback', async () => {
  const empty = createRpcHarness({ listData: { site_diaries: [], page_size: 20 } });
  assert.deepEqual(await createSiteDiariesReadAdapter(empty.rpc).list(scope()), []);
  const failure = Object.assign(new Error('permission denied'), { code: '42501' });
  const denied = createRpcHarness({ listError: failure });
  await assert.rejects(() => createSiteDiariesReadAdapter(denied.rpc).list(scope()), candidate => candidate === failure);
});

test('list preserves draft and completed lifecycle without requiring an omitted submitter field', async () => {
  const harness = createRpcHarness({
    listData: {
      page_size: 20,
      site_diaries: [
        summary({ status: 'completed', completed_at: '2026-11-20T03:00:00Z' }),
        summary({ id: OTHER_DIARY_ID, local_date: '2026-11-19' }),
      ],
    },
  });
  const result = await createSiteDiariesReadAdapter(harness.rpc).list(scope());
  assert.deepEqual(result.map(item => item.status), ['completed', 'draft']);
  assert.equal('submitted_by_id' in result[0], false);
});

test('malformed list envelopes, values and lifecycle combinations fail closed', async () => {
  for (const listData of [
    { site_diaries: [], page_size: 50 },
    { site_diaries: {}, page_size: 20 },
    { site_diaries: [summary({ status: 'unknown' })], page_size: 20 },
    { site_diaries: [summary({ local_date: '2026-02-30' })], page_size: 20 },
    { site_diaries: [summary({ status: 'draft', completed_at: '2026-11-20T03:00:00Z' })], page_size: 20 },
    { site_diaries: [summary({ status: 'completed', completed_at: null })], page_size: 20 },
    { site_diaries: [summary({ revision: -1 })], page_size: 20 },
  ]) {
    const harness = createRpcHarness({ listData });
    await assert.rejects(() => createSiteDiariesReadAdapter(harness.rpc).list(scope()));
  }
});

test('history rejects records outside newest local-date and ID ordering', async () => {
  const harness = createRpcHarness({
    listData: {
      page_size: 20,
      site_diaries: [
        summary({ id: DIARY_ID, local_date: '2026-11-19' }),
        summary({ id: OTHER_DIARY_ID, local_date: '2026-11-20' }),
      ],
    },
  });
  await assert.rejects(() => createSiteDiariesReadAdapter(harness.rpc).list(scope()), /ordering/);
});

test('exact detail uses only the diary and same-date delivery RPC projections', async () => {
  const harness = createRpcHarness();
  const result = await createSiteDiariesReadAdapter(harness.rpc).get(scope(), DIARY_ID, '2026-11-20');
  assert.deepEqual(harness.calls, [
    ['get_site_diary', { p_company_id: COMPANY_ID, p_site_diary_id: DIARY_ID }],
    ['list_site_diary_deliveries_v2', {
      p_company_id: COMPANY_ID,
      p_job_id: JOB_ID,
      p_local_date: '2026-11-20',
    }],
  ]);
  assert.equal(result.diary.id, DIARY_ID);
  assert.equal(result.deliveries[0].id, DELIVERY_ID);
});

test('detail rejects cross-company, cross-Job, cross-record and cross-date responses', () => {
  for (const payload of [
    diaryPayload({ company_id: OTHER_COMPANY_ID }),
    diaryPayload({ job_id: OTHER_JOB_ID }),
    diaryPayload({ id: OTHER_DIARY_ID }),
    diaryPayload({ local_date: '2026-11-19' }),
  ]) assert.throws(() => mapSiteDiaryRecord(payload, scope(), DIARY_ID, '2026-11-20'), /crossed/);
});

test('draft and completed lifecycle shapes validate exactly', () => {
  assert.equal(mapSiteDiaryRecord(diaryPayload(), scope(), DIARY_ID, '2026-11-20').status, 'draft');
  assert.equal(mapSiteDiaryRecord(diaryPayload({
    status: 'completed',
    submitted_by_id: USER_ID,
    completed_at: '2026-11-20T03:00:00Z',
  }), scope(), DIARY_ID, '2026-11-20').status, 'completed');
  for (const payload of [
    diaryPayload({ status: 'draft', submitted_by_id: USER_ID }),
    diaryPayload({ status: 'completed', completed_at: '2026-11-20T03:00:00Z' }),
    diaryPayload({ status: 'completed', submitted_by_id: USER_ID, completed_at: null }),
  ]) assert.throws(() => mapSiteDiaryRecord(payload, scope(), DIARY_ID, '2026-11-20'));
});

test('exact record maps only confirmed full-row fields and omits creation idempotency data', () => {
  const record = mapSiteDiaryRecord(diaryPayload(), scope(), DIARY_ID, '2026-11-20');
  assert.equal(record.work_completed_today, 'Installed TEST formwork.');
  assert.equal(record.weather_conditions, 'Fine');
  assert.equal(record.materials_used, 'TEST concrete');
  assert.equal(record.delays_issues, 'None');
  assert.equal(record.general_notes, 'TEST notes');
  assert.equal('creation_idempotency_key' in record, false);
  assert.equal('foreman_name' in record, false);
});

test('worker snapshots preserve member, manual and visitor shapes without contact data', () => {
  const record = mapSiteDiaryRecord(diaryPayload({
    workers_on_site: [
      { kind: 'member', member_user_id: USER_ID, display_name: 'Member', source_toolbox_talk_ids: [TALK_ID] },
      { kind: 'manual', display_name: 'Manual worker' },
      { kind: 'visitor', display_name: 'Visitor' },
    ],
  }), scope(), DIARY_ID, '2026-11-20');
  assert.deepEqual(record.workers_on_site.map(item => item.kind), ['member', 'manual', 'visitor']);
  assert.equal(record.workers_on_site[1].member_user_id, null);
  assert.equal('email' in record.workers_on_site[0], false);
  assert.equal('phone' in record.workers_on_site[0], false);
});

test('invalid worker membership and duplicate Toolbox Talk references fail closed', () => {
  for (const workers_on_site of [
    [{ kind: 'member', display_name: 'Missing member' }],
    [{ kind: 'manual', member_user_id: USER_ID, display_name: 'Wrong member' }],
    [{ kind: 'member', member_user_id: USER_ID, display_name: 'Member', source_toolbox_talk_ids: [TALK_ID, TALK_ID] }],
  ]) assert.throws(() => mapSiteDiaryRecord(
    diaryPayload({ workers_on_site }), scope(), DIARY_ID, '2026-11-20'
  ));
});

test('equipment is the confirmed diary-used snapshot and may retain an optional source reference', () => {
  const record = mapSiteDiaryRecord(diaryPayload(), scope(), DIARY_ID, '2026-11-20');
  assert.deepEqual(record.equipment_used, [{
    equipment_id: EQUIPMENT_ID,
    name: 'TEST Excavator',
    identifier: 'EX-001',
    category: 'machinery',
    source_toolbox_talk_ids: [TALK_ID],
  }]);
  const manual = mapSiteDiaryRecord(diaryPayload({
    equipment_used: [{ equipment_id: null, name: 'Hired pump', identifier: 'HP-1' }],
  }), scope(), DIARY_ID, '2026-11-20');
  assert.equal(manual.equipment_used[0].equipment_id, null);
  assert.equal(manual.equipment_used[0].category, null);
});

test('record accepts honest empty narrative and child collections', () => {
  const record = mapSiteDiaryRecord(diaryPayload({
    work_completed_today: '',
    weather_conditions: '',
    workers_on_site: [],
    equipment_used: [],
    materials_used: '',
    general_notes: '',
  }), scope(), DIARY_ID, '2026-11-20');
  assert.equal(record.work_completed_today, '');
  assert.deepEqual(record.workers_on_site, []);
  assert.deepEqual(record.equipment_used, []);
});

test('completed diaries require a meaningful work summary', () => {
  assert.throws(() => mapSiteDiaryRecord(diaryPayload({
    status: 'completed',
    submitted_by_id: USER_ID,
    completed_at: '2026-11-20T03:00:00Z',
    work_completed_today: ' ',
  }), scope(), DIARY_ID, '2026-11-20'), /work summary/);
});

test('correction timestamps and actors must occur together', () => {
  const corrected = mapSiteDiaryRecord(diaryPayload({
    corrected_at: '2026-11-20T04:00:00Z', corrected_by_id: USER_ID,
  }), scope(), DIARY_ID, '2026-11-20');
  assert.equal(corrected.corrected_by_id, USER_ID);
  assert.throws(() => mapSiteDiaryRecord(
    diaryPayload({ corrected_at: '2026-11-20T04:00:00Z' }), scope(), DIARY_ID, '2026-11-20'
  ));
});

test('delivery projection exposes shared date records and photo IDs as metadata only', () => {
  const deliveries = mapSiteDiaryDeliveries(deliveriesPayload(), '2026-11-20');
  assert.deepEqual(deliveries, [{
    id: DELIVERY_ID,
    local_date: '2026-11-20',
    delivered_at: '2026-11-20T01:00:00.000Z',
    created_by_id: USER_ID,
    created_by_display_name: 'TEST Recorder',
    item_description: 'TEST aggregate',
    quantity: '4 tonnes',
    supplier: 'TEST Supplier',
    notes: 'Gate two',
    photo_ids: [PHOTO_ID],
  }]);
  assert.equal('storage_path' in deliveries[0], false);
  assert.equal('purchase_order_id' in deliveries[0], false);
});

test('deliveries reject cross-date timestamps, duplicate photo IDs and bad ordering', () => {
  for (const payload of [
    deliveriesPayload({ local_date: '2026-11-19' }),
    deliveriesPayload({ delivered_at: '2026-11-19T01:00:00Z' }),
    deliveriesPayload({ photo_ids: [PHOTO_ID, PHOTO_ID] }),
    { deliveries: [
      deliveriesPayload({ delivered_at: '2026-11-20T01:00:00Z' }).deliveries[0],
      deliveriesPayload({ id: OTHER_DIARY_ID, delivered_at: '2026-11-20T02:00:00Z' }).deliveries[0],
    ] },
    { deliveries: [
      deliveriesPayload({ id: DIARY_ID, delivered_at: '2026-11-20T01:00:00Z' }).deliveries[0],
      deliveriesPayload({ id: OTHER_DIARY_ID, delivered_at: '2026-11-20T01:00:00Z' }).deliveries[0],
    ] },
  ]) assert.throws(() => mapSiteDiaryDeliveries(payload, '2026-11-20'));
});

test('either detail RPC failure aborts without substituting partial data', async () => {
  const diaryFailure = Object.assign(new Error('diary denied'), { code: '42501' });
  const deliveryFailure = new Error('delivery unavailable');
  await assert.rejects(
    () => createSiteDiariesReadAdapter(createRpcHarness({ diaryError: diaryFailure }).rpc).get(scope(), DIARY_ID, '2026-11-20'),
    candidate => candidate === diaryFailure
  );
  await assert.rejects(
    () => createSiteDiariesReadAdapter(createRpcHarness({ deliveryError: deliveryFailure }).rpc).get(scope(), DIARY_ID, '2026-11-20'),
    candidate => candidate === deliveryFailure
  );
});

test('invalid detail ID or local date fails before backend calls', async () => {
  const harness = createRpcHarness();
  const adapter = createSiteDiariesReadAdapter(harness.rpc);
  await assert.rejects(() => adapter.get(scope(), 'bad', '2026-11-20'));
  await assert.rejects(() => adapter.get(scope(), DIARY_ID, '2026-02-30'));
  assert.deepEqual(harness.calls, []);
});

test('authenticated workspace and matching verified Job are mandatory for UI scope', () => {
  assert.equal(resolveSiteDiaryReadScope({ jobScope: null, job: job() }), null);
  assert.equal(resolveSiteDiaryReadScope({ jobScope: jobScope(), job: null }), null);
  assert.equal(resolveSiteDiaryReadScope({ jobScope: { ...jobScope(), userId: '' }, job: job() }), null);
  assert.equal(resolveSiteDiaryReadScope({ jobScope: jobScope(), job: job({ company_id: OTHER_COMPANY_ID }) }), null);
  assert.equal(resolveSiteDiaryReadScope({ jobScope: jobScope(), job: job({ id: 'bad' }) }), null);
});

test('Worker, Admin and Owner produce valid Site Diary UI scopes', () => {
  for (const role of ['worker', 'admin', 'owner']) {
    const resolved = resolveSiteDiaryReadScope({ jobScope: jobScope(role), job: job() });
    assert.equal(resolved.role, role);
    assert.equal(resolved.companyId, COMPANY_ID);
    assert.equal(resolved.jobId, JOB_ID);
  }
  assert.equal(resolveSiteDiaryReadScope({ jobScope: jobScope('supervisor'), job: job() }), null);
});

test('identity, company, role, Job, diary and date changes create distinct request keys', () => {
  const resolved = resolveSiteDiaryReadScope({ jobScope: jobScope(), job: job() });
  assert.notEqual(createSiteDiaryScopeKey(resolved), createSiteDiaryScopeKey({ ...resolved, userId: OTHER_USER_ID }));
  assert.notEqual(createSiteDiaryScopeKey(resolved), createSiteDiaryScopeKey({ ...resolved, companyId: OTHER_COMPANY_ID }));
  assert.notEqual(createSiteDiaryScopeKey(resolved), createSiteDiaryScopeKey({ ...resolved, role: 'admin' }));
  assert.notEqual(createSiteDiaryScopeKey(resolved), createSiteDiaryScopeKey({ ...resolved, jobId: OTHER_JOB_ID }));
  assert.notEqual(
    createSiteDiaryRequestKey(resolved, DIARY_ID, '2026-11-20'),
    createSiteDiaryRequestKey(resolved, OTHER_DIARY_ID, '2026-11-20')
  );
  assert.notEqual(
    createSiteDiaryRequestKey(resolved, DIARY_ID, '2026-11-20'),
    createSiteDiaryRequestKey(resolved, DIARY_ID, '2026-11-19')
  );
  assert.equal(createSiteDiaryRequestKey(resolved, 'bad', '2026-11-20'), null);
});

test('permission-denied detection distinguishes access failures from general errors', () => {
  assert.equal(isSiteDiaryPermissionError({ code: '28000' }), true);
  assert.equal(isSiteDiaryPermissionError({ code: '42501' }), true);
  assert.equal(isSiteDiaryPermissionError(new Error('active company membership required')), true);
  assert.equal(isSiteDiaryPermissionError(new Error('network unavailable')), false);
});

test('page integration waits for verified Job context and mounts only the Site Diaries route', () => {
  const parent = readSource('src/pages/JobModuleRecords.jsx');
  assert.match(parent, /onsiteApi\.jobs\.get\(jobScope\.companyId, normalizedJobId\)/);
  assert.match(parent, /module\.key === 'site-diaries'/);
  assert.match(parent, /<SiteDiaryRecords jobScope=\{jobScope\} job=\{visibleJob\}/);
  assert.ok(parent.indexOf("visibleJobState !== 'ready'") < parent.indexOf('<SiteDiaryRecords'));
});

test('list and detail use independent stale-response guards and hide old scope data', () => {
  const component = readSource('src/components/site-diaries/SiteDiaryRecords.jsx');
  assert.match(component, /listRequestIdRef/);
  assert.match(component, /detailRequestIdRef/);
  assert.match(component, /setDiaries\(\[\]\)/);
  assert.match(component, /setResultScopeKey\(null\)/);
  assert.match(component, /setDetail\(null\)/);
  assert.match(component, /setDetailResultKey\(null\)/);
  assert.match(component, /resultScopeKey === scopeKey/);
  assert.match(component, /detailResultKey === detailRequestKey/);
});

test('adapter is RPC-only and contains no table, mutation, admin or service-role escape hatch', () => {
  const adapter = readSource('src/api/supabase/site-diaries-read-adapter.js');
  assert.doesNotMatch(adapter, /\.from\s*\(/);
  assert.doesNotMatch(adapter, /\.(insert|update|upsert|delete)\s*\(/);
  assert.doesNotMatch(adapter, /service_role|list_company_site_diaries_admin|export_site_diary/i);
  assert.match(adapter, /list_job_site_diaries/);
  assert.match(adapter, /get_site_diary/);
  assert.match(adapter, /list_site_diary_deliveries_v2/);
});

test('UI remains read-only and labels confirmed limitations and actual-use semantics', () => {
  const component = readSource('src/components/site-diaries/SiteDiaryRecords.jsx');
  assert.match(component, /View only/);
  assert.match(component, /Equipment actually used/);
  assert.match(component, /foreman’s display name/);
  assert.match(component, /Deliveries are shared across same-date diaries/);
  assert.match(component, /No Storage URL or structured Purchase Order reference/);
  assert.doesNotMatch(component, /\b(Create|Edit|Delete|Submit|Complete) diary\b/i);
});

test('Site Diaries remains a job-first navigation module at the canonical route', () => {
  const diaryModule = JOB_FIRST_MODULES['site-diaries'];
  assert.equal(diaryModule.path, '/work/site-diaries/jobs');
  assert.equal(diaryModule.jobFirst, true);
});
