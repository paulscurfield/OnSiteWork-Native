import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createToolboxTalksReadAdapter,
  mapToolboxTalkRecord,
} from '../../src/api/supabase/toolbox-talks-read-adapter.js';
import {
  createToolboxTalkRequestKey,
  createToolboxTalkScopeKey,
  isToolboxTalkPermissionError,
  resolveToolboxTalkReadScope,
} from '../../src/lib/toolbox-talk-access.js';
import { JOB_FIRST_MODULES } from '../../src/navigation/dashboard-modules.js';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_JOB_ID = '44444444-4444-4444-8444-444444444444';
const TALK_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_TALK_ID = '66666666-6666-4666-8666-666666666666';
const ATTENDEE_ID = '77777777-7777-4777-8777-777777777777';
const EQUIPMENT_ROW_ID = '88888888-8888-4888-8888-888888888888';
const EQUIPMENT_ID = '99999999-9999-4999-8999-999999999999';
const QUESTION_ID = '10101010-1010-4010-8010-101010101010';

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
  id: TALK_ID,
  local_date: '2026-11-20',
  status: 'completed',
  conducted_by_name: ' TEST Foreman ',
  completed_at: '2026-11-20T01:30:00.000Z',
  attendee_count: 2,
  ...overrides,
});

const detail = ({ talk = {}, attendees, equipment, questions } = {}) => ({
  toolbox_talk: {
    id: TALK_ID,
    company_id: COMPANY_ID,
    job_id: JOB_ID,
    local_date: '2026-11-20',
    local_timezone: 'Australia/Sydney',
    status: 'completed',
    created_by_id: USER_ID,
    conducted_by_id: USER_ID,
    conducted_by_name: ' TEST Foreman ',
    job_name_snapshot: ' TEST Harbour Job ',
    job_number_snapshot: ' JOB-001 ',
    job_address_snapshot: ' 1 Test Street ',
    safety_details: {
      base44_question_snapshot: [{
        number: 1,
        question: ' Today’s Date ',
        answer: ' 20/11/2026 ',
      }],
    },
    completed_at: '2026-11-20T01:30:00.000Z',
    ...talk,
  },
  attendees: attendees ?? [{
    id: ATTENDEE_ID,
    member_user_id: USER_ID,
    name: ' TEST Worker ',
    kind: 'member',
  }],
  equipment: equipment ?? [{
    id: EQUIPMENT_ROW_ID,
    equipment_id: EQUIPMENT_ID,
    name: ' TEST Excavator ',
    identifier: ' EX-001 ',
    category: ' machinery ',
    operator_user_id: USER_ID,
    operator_name: ' TEST Operator ',
  }],
  questions: questions ?? [{
    id: QUESTION_ID,
    source_scope: 'company',
    question_text: ' Is the exclusion zone ready? ',
    question_type: 'yes_no_na',
    selection_options: [],
    is_required: true,
    answer: 'yes',
  }],
});

const createRpcHarness = ({ listData, listError = null, detailData, detailError = null } = {}) => {
  const calls = [];
  return {
    calls,
    async rpc(name, params) {
      calls.push([name, params]);
      if (name === 'list_job_toolbox_talks') {
        return { data: listData ?? { toolbox_talks: [summary()], page_size: 20 }, error: listError };
      }
      if (name === 'get_toolbox_talk') {
        return { data: detailData ?? detail(), error: detailError };
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

test('completed listing uses only the committed company-and-Job RPC contract', async () => {
  const harness = createRpcHarness();
  const talks = await createToolboxTalksReadAdapter(harness.rpc).list(scope());
  assert.deepEqual(harness.calls, [[
    'list_job_toolbox_talks',
    {
      p_company_id: COMPANY_ID,
      p_job_id: JOB_ID,
      p_before_completed_at: null,
      p_before_id: null,
    },
  ]]);
  assert.deepEqual(talks, [{
    id: TALK_ID,
    local_date: '2026-11-20',
    status: 'completed',
    conducted_by_name: 'TEST Foreman',
    completed_at: '2026-11-20T01:30:00.000Z',
    attendee_count: 2,
  }]);
});

test('missing authenticated identity, workspace, role or verified Job fails before an RPC', async () => {
  const harness = createRpcHarness();
  const adapter = createToolboxTalksReadAdapter(harness.rpc);
  for (const candidate of [
    null,
    { ...scope(), userId: '' },
    { ...scope(), companyId: 'bad' },
    { ...scope(), jobId: 'bad' },
    { ...scope(), role: 'supervisor' },
  ]) await assert.rejects(() => adapter.list(candidate));
  assert.deepEqual(harness.calls, []);
});

test('empty completed history remains empty and backend failures propagate without fallback', async () => {
  const emptyHarness = createRpcHarness({ listData: { toolbox_talks: [], page_size: 20 } });
  assert.deepEqual(await createToolboxTalksReadAdapter(emptyHarness.rpc).list(scope()), []);
  const failure = Object.assign(new Error('permission denied'), { code: '42501' });
  const errorHarness = createRpcHarness({ listError: failure });
  await assert.rejects(() => createToolboxTalksReadAdapter(errorHarness.rpc).list(scope()), candidate => candidate === failure);
});

test('Worker, Admin and Owner retain the same completed-history read RPC', async () => {
  for (const role of ['worker', 'admin', 'owner']) {
    const harness = createRpcHarness();
    const result = await createToolboxTalksReadAdapter(harness.rpc).list(scope(role));
    assert.equal(result.length, 1);
    assert.equal(harness.calls[0][0], 'list_job_toolbox_talks');
  }
});

test('list mapping rejects drafts, malformed dates, counts, timestamps and envelopes', async () => {
  for (const listData of [
    { toolbox_talks: [summary({ status: 'draft' })], page_size: 20 },
    { toolbox_talks: [summary({ local_date: '2026-02-30' })], page_size: 20 },
    { toolbox_talks: [summary({ attendee_count: -1 })], page_size: 20 },
    { toolbox_talks: [summary({ completed_at: 'not-a-time' })], page_size: 20 },
    { toolbox_talks: [], page_size: 50 },
    { toolbox_talks: {}, page_size: 20 },
  ]) {
    const harness = createRpcHarness({ listData });
    await assert.rejects(() => createToolboxTalksReadAdapter(harness.rpc).list(scope()));
  }
});

test('list mapping rejects records that are not in newest-first completion order', async () => {
  const harness = createRpcHarness({
    listData: {
      page_size: 20,
      toolbox_talks: [
        summary({ completed_at: '2026-11-19T01:00:00Z' }),
        summary({ id: OTHER_TALK_ID, completed_at: '2026-11-20T01:00:00Z' }),
      ],
    },
  });
  await assert.rejects(() => createToolboxTalksReadAdapter(harness.rpc).list(scope()), /ordering/);
});

test('detail read uses the approved record RPC and pins its response to company, Job and record', async () => {
  const harness = createRpcHarness();
  const record = await createToolboxTalksReadAdapter(harness.rpc).get(scope(), TALK_ID);
  assert.deepEqual(harness.calls, [[
    'get_toolbox_talk',
    { p_company_id: COMPANY_ID, p_toolbox_talk_id: TALK_ID },
  ]]);
  assert.equal(record.company_id, COMPANY_ID);
  assert.equal(record.job_id, JOB_ID);
  assert.equal(record.id, TALK_ID);
  assert.equal(record.status, 'completed');
});

test('detail mapping rejects cross-company, cross-Job, cross-record and draft responses', () => {
  for (const payload of [
    detail({ talk: { company_id: OTHER_COMPANY_ID } }),
    detail({ talk: { job_id: OTHER_JOB_ID } }),
    detail({ talk: { id: OTHER_TALK_ID } }),
    detail({ talk: { status: 'draft', completed_at: null } }),
  ]) assert.throws(() => mapToolboxTalkRecord(payload, scope(), TALK_ID));
});

test('record maps approved question snapshots and historical answers without inventing fields', () => {
  const record = mapToolboxTalkRecord(detail(), scope(), TALK_ID);
  assert.deepEqual(record.safety_questions, [{ number: 1, question: 'Today’s Date', answer: '20/11/2026' }]);
  assert.deepEqual(record.questions, [{
    id: QUESTION_ID,
    source_scope: 'company',
    question_text: 'Is the exclusion zone ready?',
    question_type: 'yes_no_na',
    is_required: true,
    answer: 'yes',
  }]);
  assert.equal('safety_details' in record, false);
  assert.equal('draft_payload' in record, false);
});

test('record preserves attendee snapshots without reading Team directory contacts', () => {
  const record = mapToolboxTalkRecord(detail(), scope(), TALK_ID);
  assert.deepEqual(record.attendees, [{
    id: ATTENDEE_ID,
    member_user_id: USER_ID,
    name: 'TEST Worker',
    kind: 'member',
  }]);
  assert.equal('email' in record.attendees[0], false);
  assert.equal('phone' in record.attendees[0], false);
});

test('planned equipment and optional operator snapshots map without claiming actual use', () => {
  const record = mapToolboxTalkRecord(detail(), scope(), TALK_ID);
  assert.deepEqual(record.equipment, [{
    id: EQUIPMENT_ROW_ID,
    equipment_id: EQUIPMENT_ID,
    name: 'TEST Excavator',
    identifier: 'EX-001',
    category: 'machinery',
    operator_user_id: USER_ID,
    operator_name: 'TEST Operator',
  }]);
  const unassigned = mapToolboxTalkRecord(detail({
    equipment: [{
      id: EQUIPMENT_ROW_ID,
      equipment_id: null,
      name: 'Retired TEST Excavator',
      identifier: 'EX-OLD',
      category: null,
      operator_user_id: null,
      operator_name: null,
    }],
  }), scope(), TALK_ID);
  assert.equal(unassigned.equipment[0].operator_name, null);
});

test('missing optional child records remain honest empty collections', () => {
  const record = mapToolboxTalkRecord(detail({
    talk: { safety_details: {} },
    attendees: [],
    equipment: [],
    questions: [],
  }), scope(), TALK_ID);
  assert.deepEqual(record.safety_questions, []);
  assert.deepEqual(record.attendees, []);
  assert.deepEqual(record.equipment, []);
  assert.deepEqual(record.questions, []);
});

test('malformed attendee, equipment and question contracts fail closed', () => {
  for (const payload of [
    detail({ attendees: [{ id: ATTENDEE_ID, member_user_id: null, name: 'TEST', kind: 'unknown' }] }),
    detail({ equipment: [{ id: EQUIPMENT_ROW_ID, equipment_id: null, name: '', identifier: 'EX', category: null, operator_user_id: null, operator_name: null }] }),
    detail({ questions: [{ id: QUESTION_ID, source_scope: 'other', question_text: 'TEST?', question_type: 'short_text', is_required: false, answer: null }] }),
    detail({ questions: [{ id: QUESTION_ID, source_scope: 'job', question_text: 'TEST?', question_type: 'rating', is_required: false, answer: null }] }),
  ]) assert.throws(() => mapToolboxTalkRecord(payload, scope(), TALK_ID));
});

test('invalid detail ID fails before a backend call', async () => {
  const harness = createRpcHarness();
  await assert.rejects(() => createToolboxTalksReadAdapter(harness.rpc).get(scope(), 'bad'));
  assert.deepEqual(harness.calls, []);
});

test('authenticated workspace and matching verified Job are mandatory for UI scope', () => {
  assert.equal(resolveToolboxTalkReadScope({ jobScope: null, job: job() }), null);
  assert.equal(resolveToolboxTalkReadScope({ jobScope: jobScope(), job: null }), null);
  assert.equal(resolveToolboxTalkReadScope({ jobScope: { ...jobScope(), userId: '' }, job: job() }), null);
  assert.equal(resolveToolboxTalkReadScope({ jobScope: jobScope(), job: job({ company_id: OTHER_COMPANY_ID }) }), null);
  assert.equal(resolveToolboxTalkReadScope({ jobScope: jobScope(), job: job({ id: 'bad' }) }), null);
});

test('Worker, Admin and Owner produce valid completed-history UI scopes', () => {
  for (const role of ['worker', 'admin', 'owner']) {
    const resolved = resolveToolboxTalkReadScope({ jobScope: jobScope(role), job: job() });
    assert.equal(resolved.role, role);
    assert.equal(resolved.companyId, COMPANY_ID);
    assert.equal(resolved.jobId, JOB_ID);
  }
  assert.equal(resolveToolboxTalkReadScope({ jobScope: jobScope('supervisor'), job: job() }), null);
});

test('identity, company, role, Job and selected record changes create distinct request keys', () => {
  const resolved = resolveToolboxTalkReadScope({ jobScope: jobScope(), job: job() });
  assert.notEqual(createToolboxTalkScopeKey(resolved), createToolboxTalkScopeKey({ ...resolved, userId: OTHER_USER_ID }));
  assert.notEqual(createToolboxTalkScopeKey(resolved), createToolboxTalkScopeKey({ ...resolved, companyId: OTHER_COMPANY_ID }));
  assert.notEqual(createToolboxTalkScopeKey(resolved), createToolboxTalkScopeKey({ ...resolved, role: 'admin' }));
  assert.notEqual(createToolboxTalkScopeKey(resolved), createToolboxTalkScopeKey({ ...resolved, jobId: OTHER_JOB_ID }));
  assert.notEqual(createToolboxTalkRequestKey(resolved, TALK_ID), createToolboxTalkRequestKey(resolved, OTHER_TALK_ID));
  assert.equal(createToolboxTalkRequestKey(resolved, 'bad'), null);
});

test('permission-denied detection distinguishes access failures from general errors', () => {
  assert.equal(isToolboxTalkPermissionError({ code: '28000' }), true);
  assert.equal(isToolboxTalkPermissionError({ code: '42501' }), true);
  assert.equal(isToolboxTalkPermissionError(new Error('active company membership required')), true);
  assert.equal(isToolboxTalkPermissionError(new Error('network unavailable')), false);
});

test('page integration waits for verified Job context and mounts only the Toolbox Talks route', () => {
  const parent = readSource('src/pages/JobModuleRecords.jsx');
  assert.match(parent, /onsiteApi\.jobs\.get\(jobScope\.companyId, normalizedJobId\)/);
  assert.match(parent, /module\.key === 'toolbox-talks'/);
  assert.match(parent, /<ToolboxTalkRecords jobScope=\{jobScope\} job=\{visibleJob\}/);
  assert.ok(parent.indexOf("visibleJobState !== 'ready'") < parent.indexOf('<ToolboxTalkRecords'));
});

test('list and detail use independent stale-response guards and immediately hide old scope data', () => {
  const component = readSource('src/components/toolbox-talks/ToolboxTalkRecords.jsx');
  assert.match(component, /setTalks\(\[\]\)/);
  assert.match(component, /setSelectedTalkId\(null\)/);
  assert.match(component, /setDetail\(null\)/);
  assert.match(component, /requestId !== listRequestIdRef\.current/);
  assert.match(component, /requestId !== detailRequestIdRef\.current/);
  assert.match(component, /resultScopeKey === scopeKey/);
  assert.match(component, /detailResultKey === detailRequestKey/);
});

test('Toolbox Talks integration exposes completed list/detail only with no mutation surface', () => {
  const files = [
    'src/api/supabase/toolbox-talks-read-adapter.js',
    'src/components/toolbox-talks/ToolboxTalkRecords.jsx',
    'src/lib/toolbox-talk-access.js',
  ].map(readSource).join('\n').toLowerCase();
  for (const token of [
    '.from(', '.insert(', '.update(', '.delete(', '.upsert(', 'create_toolbox_talk',
    'complete_toolbox_talk', 'list_job_toolbox_talk_drafts_admin', 'upsert_toolbox_talk_question_template',
    'service_role', 'generate pdf', 'download=', 'send notification',
  ]) assert.equal(files.includes(token), false, token);
  assert.match(files, /list_job_toolbox_talks/);
  assert.match(files, /get_toolbox_talk/);
});

test('presentation labels planned equipment honestly and never invents Pre-Start clearance', () => {
  const source = readSource('src/components/toolbox-talks/ToolboxTalkRecords.jsx');
  assert.match(source, /Planned equipment/);
  assert.match(source, /Pre-Start status unavailable/);
  assert.match(source, /not proof of completed Pre-Starts/);
  assert.match(source, /actual equipment use/);
  assert.doesNotMatch(source, /safe to operate|cleared to operate/i);
});

test('questions, attendee names and operator snapshots are displayed without private contacts', () => {
  const source = readSource('src/components/toolbox-talks/ToolboxTalkRecords.jsx');
  assert.match(source, /safety_questions/);
  assert.match(source, /talk\.questions/);
  assert.match(source, /talk\.attendees/);
  assert.match(source, /operator_name/);
  assert.doesNotMatch(source, /attendee\.email|attendee\.phone|worker_email/);
});

test('Purchase Orders and the remaining job-first route shells are preserved', () => {
  assert.deepEqual(Object.keys(JOB_FIRST_MODULES), [
    'pre-starts', 'toolbox-talks', 'site-diaries', 'site-photos', 'purchase-orders',
  ]);
  const parent = readSource('src/pages/JobModuleRecords.jsx');
  assert.match(parent, /module\.key === 'purchase-orders'/);
  assert.match(parent, /<PurchaseOrderRecords jobScope=\{jobScope\} job=\{visibleJob\}/);
  assert.match(parent, /Module integration pending/);
  for (const key of ['pre-starts', 'site-diaries', 'site-photos']) {
    assert.equal(JOB_FIRST_MODULES[key].jobFirst, true);
  }
});
