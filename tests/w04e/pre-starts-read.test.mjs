import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createPreStartsReadAdapter,
  mapPreStartDetail,
  mapPreStartPhotoMetadata,
} from '../../src/api/supabase/pre-starts-read-adapter.js';
import {
  createPreStartDetailRequestKey,
  createPreStartEquipmentScopeKey,
  resolvePreStartEquipmentScope,
  resolvePreStartJobScope,
} from '../../src/lib/pre-start-access.js';
import { DASHBOARD_MODULES, getJobRecordsPath, JOB_FIRST_MODULES } from '../../src/navigation/dashboard-modules.js';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const EQUIPMENT_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_EQUIPMENT_ID = '44444444-4444-4444-8444-444444444444';
const INSPECTION_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_INSPECTION_ID = '66666666-6666-4666-8666-666666666666';
const JOB_ID = '77777777-7777-4777-8777-777777777777';
const OTHER_JOB_ID = '88888888-8888-4888-8888-888888888888';
const QUESTION_ID = '99999999-9999-4999-8999-999999999999';
const FAULT_ID = 'abababab-abab-4bab-8bab-abababababab';
const PHOTO_ID = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';

const adminScope = (overrides = {}) => ({
  userId: ADMIN_ID,
  companyId: COMPANY_ID,
  companyName: 'Alpha',
  role: 'admin',
  equipmentId: EQUIPMENT_ID,
  equipmentName: 'Excavator',
  equipmentIdentifier: 'EX-01',
  equipmentCategory: 'machinery',
  canReadCompanyHistory: true,
  ...overrides,
});

const summaryRow = (overrides = {}) => ({
  id: INSPECTION_ID,
  company_id: COMPANY_ID,
  equipment_id: EQUIPMENT_ID,
  equipment_name: 'Excavator',
  equipment_identifier: 'EX-01',
  equipment_category: 'machinery',
  inspector_display_name: 'Worker One',
  local_date: '2026-11-22',
  status: 'submitted',
  safety_status: 'attention_required',
  is_primary: true,
  job_id: JOB_ID,
  submitted_at: '2026-11-22T01:00:00Z',
  updated_at: '2026-11-22T01:00:00Z',
  fault_count: 1,
  open_fault_count: 1,
  ...overrides,
});

const questionRow = (overrides = {}) => ({
  id: QUESTION_ID,
  stable_key: 'tyres',
  display_order: 1,
  prompt: 'Are the tyres serviceable?',
  response_type: 'single_choice',
  options: ['Yes', 'No', 'N/A'],
  is_required: true,
  allows_na: true,
  ...overrides,
});

const faultRow = (overrides = {}) => ({
  id: FAULT_ID,
  question_id: QUESTION_ID,
  severity: 'serious',
  status: 'under_repair',
  description: 'Front tyre is damaged',
  notification_target: 'management',
  notified: true,
  created_at: '2026-11-22T01:00:00Z',
  ...overrides,
});

const detailPayload = (overrides = {}) => ({
  inspection: {
    id: INSPECTION_ID,
    company_id: COMPANY_ID,
    equipment_id: EQUIPMENT_ID,
    inspector_id: USER_ID,
    job_id: JOB_ID,
    local_date: '2026-11-22',
    inspected_at: '2026-11-22T00:55:00Z',
    is_primary: true,
    exceptional_reinspection_reason: null,
    status: 'submitted',
    safety_status: 'attention_required',
    revision: 2,
    draft_answers: null,
    submitted_at: '2026-11-22T01:00:00Z',
    submitted_by_id: USER_ID,
    answers: [{
      question_id: QUESTION_ID,
      question: {
        stable_key: 'tyres',
        display_order: 1,
        prompt: 'Are the tyres serviceable?',
        response_type: 'single_choice',
        options: ['Yes', 'No', 'N/A'],
        allows_na: true,
        fault_severity: 'serious',
      },
      answer: { answer: 'N/A' },
      na_reason: 'Not fitted to this machine',
    }],
    faults: [faultRow()],
    acknowledgements: [],
  },
  equipment: {
    id: EQUIPMENT_ID,
    name: 'Excavator',
    identifier: 'EX-01',
    category: 'machinery',
  },
  inspector_display_name: 'Worker One',
  submitted_by_display_name: 'Worker One',
  template_questions: [questionRow()],
  ...overrides,
});

const photoPayload = (overrides = {}) => ({
  photos: [{
    photo_id: PHOTO_ID,
    fault_id: FAULT_ID,
    media_type: 'image/jpeg',
    file_size_bytes: 2048,
    upload_status: 'available',
    created_at: '2026-11-22T01:01:00Z',
    uploaded_at: '2026-11-22T01:02:00Z',
    storage_path: 'must-not-be-returned',
    ...overrides,
  }],
});

const equipment = (overrides = {}) => ({
  id: EQUIPMENT_ID,
  company_id: COMPANY_ID,
  name: 'Excavator',
  equipment_id: 'EX-01',
  category: 'machinery',
  requires_pre_start: true,
  ...overrides,
});

const equipmentScope = (overrides = {}) => ({
  userId: ADMIN_ID,
  companyId: COMPANY_ID,
  companyName: 'Alpha',
  role: 'admin',
  ...overrides,
});

const readSource = relativePath => fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

const createRpcHarness = responses => {
  const calls = [];
  const queue = [...responses];
  return {
    calls,
    rpc: async (name, params) => {
      calls.push([name, params]);
      if (!queue.length) throw new Error('Unexpected RPC call');
      return queue.shift();
    },
  };
};

test('equipment scope requires authentication, matching workspace, eligibility and an approved role', () => {
  assert.equal(resolvePreStartEquipmentScope({ equipmentScope: null, equipment: equipment() }), null);
  assert.equal(resolvePreStartEquipmentScope({ equipmentScope: equipmentScope({ userId: null }), equipment: equipment() }), null);
  assert.equal(resolvePreStartEquipmentScope({ equipmentScope: equipmentScope(), equipment: null }), null);
  assert.equal(resolvePreStartEquipmentScope({ equipmentScope: equipmentScope(), equipment: equipment({ company_id: OTHER_COMPANY_ID }) }), null);
  assert.equal(resolvePreStartEquipmentScope({ equipmentScope: equipmentScope(), equipment: equipment({ id: 'invalid' }) }), null);
  assert.equal(resolvePreStartEquipmentScope({ equipmentScope: equipmentScope(), equipment: equipment({ requires_pre_start: false }) }), null);
  assert.equal(resolvePreStartEquipmentScope({ equipmentScope: equipmentScope(), equipment: equipment({ category: 'tools' }) }), null);
  assert.equal(resolvePreStartEquipmentScope({ equipmentScope: equipmentScope({ role: 'manager' }), equipment: equipment() }), null);
});

test('Owner/Admin receive company-history capability while Worker and historical supervisor remain fail-closed', () => {
  for (const role of ['owner', 'admin']) {
    assert.equal(resolvePreStartEquipmentScope({ equipmentScope: equipmentScope({ role }), equipment: equipment() }).canReadCompanyHistory, true);
  }
  const worker = resolvePreStartEquipmentScope({ equipmentScope: equipmentScope({ role: 'worker' }), equipment: equipment() });
  assert.equal(worker.canReadCompanyHistory, false);
  assert.equal(resolvePreStartEquipmentScope({ equipmentScope: equipmentScope({ role: 'supervisor' }), equipment: equipment() }), null);
});

test('scope and detail keys change across identity, role, company, Equipment and inspection', () => {
  const base = adminScope();
  assert.notEqual(createPreStartEquipmentScopeKey(base), createPreStartEquipmentScopeKey({ ...base, userId: USER_ID }));
  assert.notEqual(createPreStartEquipmentScopeKey(base), createPreStartEquipmentScopeKey({ ...base, role: 'owner' }));
  assert.notEqual(createPreStartEquipmentScopeKey(base), createPreStartEquipmentScopeKey({ ...base, companyId: OTHER_COMPANY_ID }));
  assert.notEqual(createPreStartEquipmentScopeKey(base), createPreStartEquipmentScopeKey({ ...base, equipmentId: OTHER_EQUIPMENT_ID }));
  assert.notEqual(createPreStartDetailRequestKey(base, INSPECTION_ID), createPreStartDetailRequestKey(base, OTHER_INSPECTION_ID));
  assert.equal(createPreStartDetailRequestKey(base, 'invalid'), null);
});

test('job scope requires a verified Job belonging to the active company', () => {
  const jobScope = { userId: ADMIN_ID, companyId: COMPANY_ID, role: 'admin' };
  const job = { id: JOB_ID, company_id: COMPANY_ID, job_name: 'Hospital' };
  assert.equal(resolvePreStartJobScope({ jobScope, job }).jobId, JOB_ID);
  assert.equal(resolvePreStartJobScope({ jobScope, job: { ...job, company_id: OTHER_COMPANY_ID } }), null);
  assert.equal(resolvePreStartJobScope({ jobScope, job: { ...job, id: 'invalid' } }), null);
  assert.equal(resolvePreStartJobScope({ jobScope: { ...jobScope, userId: null }, job }), null);
});

test('equipment history calls only the confirmed admin RPC with exact Equipment scope and null filters', async () => {
  const harness = createRpcHarness([{ data: { page_size: 20, inspections: [summaryRow()] }, error: null }]);
  const result = await createPreStartsReadAdapter(harness.rpc).listEquipmentHistory(adminScope());
  assert.equal(result.items.length, 1);
  assert.equal(result.has_more, false);
  assert.deepEqual(harness.calls, [[
    'list_company_pre_start_history_admin_v2',
    {
      p_company_id: COMPANY_ID,
      p_before_date: null,
      p_before_updated_at: null,
      p_before_id: null,
      p_equipment_id: EQUIPMENT_ID,
      p_status: null,
      p_date_from: null,
      p_date_to: null,
    },
  ]]);
});

test('history preserves explicit and null Job associations without invention', async () => {
  const harness = createRpcHarness([{ data: { page_size: 20, inspections: [summaryRow({ job_id: null })] }, error: null }]);
  const result = await createPreStartsReadAdapter(harness.rpc).listEquipmentHistory(adminScope());
  assert.equal(result.items[0].job_id, null);
  assert.equal(summaryRow().job_id, JOB_ID);
});

test('empty history remains empty and a complete 20-row page exposes the cursor boundary', async () => {
  const empty = createRpcHarness([{ data: { page_size: 20, inspections: [] }, error: null }]);
  assert.deepEqual(await createPreStartsReadAdapter(empty.rpc).listEquipmentHistory(adminScope()), { items: [], has_more: false });
  const rows = Array.from({ length: 20 }, (_, index) => summaryRow({
    id: `${String(20 - index).padStart(8, '0')}-1111-4111-8111-111111111111`,
  }));
  const full = createRpcHarness([{ data: { page_size: 20, inspections: rows }, error: null }]);
  assert.equal((await createPreStartsReadAdapter(full.rpc).listEquipmentHistory(adminScope())).has_more, true);
});

test('history supports the native cursor, status and date-filter arguments', async () => {
  const harness = createRpcHarness([{ data: { page_size: 20, inspections: [] }, error: null }]);
  await createPreStartsReadAdapter(harness.rpc).listEquipmentHistory(adminScope(), {
    cursor: { localDate: '2026-11-20', updatedAt: '2026-11-20T01:00:00Z', id: INSPECTION_ID },
    status: 'draft',
    dateFrom: '2026-11-01',
    dateTo: '2026-11-20',
  });
  assert.deepEqual(harness.calls[0][1], {
    p_company_id: COMPANY_ID,
    p_before_date: '2026-11-20',
    p_before_updated_at: '2026-11-20T01:00:00Z',
    p_before_id: INSPECTION_ID,
    p_equipment_id: EQUIPMENT_ID,
    p_status: 'draft',
    p_date_from: '2026-11-01',
    p_date_to: '2026-11-20',
  });
});

test('invalid filters and Worker history are rejected before an RPC call', async () => {
  const harness = createRpcHarness([]);
  const adapter = createPreStartsReadAdapter(harness.rpc);
  await assert.rejects(() => adapter.listEquipmentHistory(adminScope(), { status: 'complete' }), /status filter/);
  await assert.rejects(() => adapter.listEquipmentHistory(adminScope(), { dateFrom: '2026-11-30', dateTo: '2026-11-01' }), /cannot be before/);
  await assert.rejects(() => adapter.listEquipmentHistory(adminScope({ role: 'worker', canReadCompanyHistory: false })), error => error.code === '42501');
  assert.equal(harness.calls.length, 0);
});

test('history rejects cross-company and cross-Equipment records', async () => {
  for (const row of [summaryRow({ company_id: OTHER_COMPANY_ID }), summaryRow({ equipment_id: OTHER_EQUIPMENT_ID })]) {
    const harness = createRpcHarness([{ data: { page_size: 20, inspections: [row] }, error: null }]);
    await assert.rejects(() => createPreStartsReadAdapter(harness.rpc).listEquipmentHistory(adminScope()), /crossed/);
  }
});

test('history rejects malformed lifecycle, enums, page size and ordering', async () => {
  const invalidPayloads = [
    { page_size: 19, inspections: [] },
    { page_size: 20, inspections: [summaryRow({ status: 'complete' })] },
    { page_size: 20, inspections: [summaryRow({ status: 'draft', submitted_at: '2026-11-22T01:00:00Z' })] },
    { page_size: 20, inspections: [summaryRow({ safety_status: 'clear' })] },
    { page_size: 20, inspections: [summaryRow({ local_date: '2026-02-30' })] },
    { page_size: 20, inspections: [summaryRow({ local_date: '2026-11-21' }), summaryRow({ id: OTHER_INSPECTION_ID, local_date: '2026-11-22' })] },
  ];
  for (const payload of invalidPayloads) {
    const harness = createRpcHarness([{ data: payload, error: null }]);
    await assert.rejects(() => createPreStartsReadAdapter(harness.rpc).listEquipmentHistory(adminScope()));
  }
});

test('permission denials and backend failures propagate without fabricated records', async () => {
  for (const error of [Object.assign(new Error('denied'), { code: '42501' }), new Error('offline')]) {
    const harness = createRpcHarness([{ data: null, error }]);
    await assert.rejects(() => createPreStartsReadAdapter(harness.rpc).listEquipmentHistory(adminScope()), candidate => candidate === error);
  }
});

test('detail uses exact admin detail then metadata-only photo RPC', async () => {
  const harness = createRpcHarness([
    { data: detailPayload(), error: null },
    { data: photoPayload(), error: null },
  ]);
  const result = await createPreStartsReadAdapter(harness.rpc).getEquipmentInspection(adminScope(), INSPECTION_ID);
  assert.equal(result.inspection.id, INSPECTION_ID);
  assert.equal(result.photos.length, 1);
  assert.deepEqual(harness.calls, [
    ['get_pre_start_inspection_admin', { p_company_id: COMPANY_ID, p_inspection_id: INSPECTION_ID }],
    ['list_pre_start_fault_photos', { p_company_id: COMPANY_ID, p_inspection_id: INSPECTION_ID }],
  ]);
});

test('submitted detail preserves N/A, notes, fault severity, status and inspector snapshots', () => {
  const detail = mapPreStartDetail(detailPayload(), adminScope(), INSPECTION_ID);
  assert.equal(detail.inspection.answers[0].answer, 'N/A');
  assert.equal(detail.inspection.answers[0].na_reason, 'Not fitted to this machine');
  assert.equal(detail.inspection.faults[0].severity, 'serious');
  assert.equal(detail.inspection.faults[0].status, 'under_repair');
  assert.equal(detail.inspector_display_name, 'Worker One');
  assert.equal(detail.inspection.safety_status, 'attention_required');
});

test('draft detail preserves saved answers and does not turn missing answers into Pass', () => {
  const payload = detailPayload();
  payload.inspection = {
    ...payload.inspection,
    status: 'draft',
    safety_status: 'pending',
    submitted_at: null,
    submitted_by_id: null,
    answers: [],
    faults: [],
    draft_answers: {
      [QUESTION_ID]: { answer: 'N/A', na_reason: 'Not installed', fault_description: null, notified: null },
    },
  };
  payload.submitted_by_display_name = null;
  const detail = mapPreStartDetail(payload, adminScope(), INSPECTION_ID);
  assert.equal(detail.inspection.draft_answers[QUESTION_ID].answer, 'N/A');
  assert.equal(detail.inspection.draft_answers[QUESTION_ID].na_reason, 'Not installed');
  assert.equal(detail.inspection.answers.length, 0);
});

test('detail preserves a legitimate null Job without assigning a recent or planned Job', () => {
  const payload = detailPayload();
  payload.inspection = { ...payload.inspection, job_id: null };
  const detail = mapPreStartDetail(payload, adminScope(), INSPECTION_ID);
  assert.equal(detail.inspection.job_id, null);
  assert.notEqual(detail.inspection.job_id, JOB_ID);
});

test('detail rejects cross-company, cross-Equipment and wrong-inspection responses', () => {
  const cases = [
    detailPayload({ inspection: { ...detailPayload().inspection, company_id: OTHER_COMPANY_ID } }),
    detailPayload({ inspection: { ...detailPayload().inspection, equipment_id: OTHER_EQUIPMENT_ID } }),
    detailPayload({ inspection: { ...detailPayload().inspection, id: OTHER_INSPECTION_ID } }),
    detailPayload({ equipment: { ...detailPayload().equipment, id: OTHER_EQUIPMENT_ID } }),
  ];
  for (const payload of cases) assert.throws(() => mapPreStartDetail(payload, adminScope(), INSPECTION_ID), /crossed|mismatched/);
});

test('detail rejects malformed answers, statuses, faults and question associations', () => {
  const invalid = [];
  invalid.push(detailPayload({ inspection: { ...detailPayload().inspection, safety_status: 'operational' } }));
  invalid.push(detailPayload({ inspection: { ...detailPayload().inspection, answers: [{ ...detailPayload().inspection.answers[0], answer: 4 }] } }));
  invalid.push(detailPayload({ inspection: { ...detailPayload().inspection, faults: [faultRow({ severity: 'critical' })] } }));
  invalid.push(detailPayload({ inspection: { ...detailPayload().inspection, faults: [faultRow({ question_id: OTHER_INSPECTION_ID })] } }));
  invalid.push(detailPayload({ template_questions: [questionRow({ response_type: 'checkboxes' })] }));
  for (const payload of invalid) assert.throws(() => mapPreStartDetail(payload, adminScope(), INSPECTION_ID));
});

test('photo metadata exposes no Storage path or URL and validates fault ownership', () => {
  const detail = mapPreStartDetail(detailPayload(), adminScope(), INSPECTION_ID);
  const photos = mapPreStartPhotoMetadata(photoPayload(), detail);
  assert.deepEqual(Object.keys(photos[0]), ['photo_id', 'fault_id', 'media_type', 'file_size_bytes', 'upload_status', 'created_at', 'uploaded_at']);
  assert.equal(JSON.stringify(photos).includes('storage_path'), false);
  assert.throws(() => mapPreStartPhotoMetadata(photoPayload({ fault_id: OTHER_INSPECTION_ID }), detail), /crossed/);
  assert.throws(() => mapPreStartPhotoMetadata(photoPayload({ file_size_bytes: 0 }), detail), /photo size/);
});

test('detail does not continue to photo metadata when exact inspection validation fails', async () => {
  const harness = createRpcHarness([{ data: detailPayload({ equipment: { ...detailPayload().equipment, id: OTHER_EQUIPMENT_ID } }), error: null }]);
  await assert.rejects(() => createPreStartsReadAdapter(harness.rpc).getEquipmentInspection(adminScope(), INSPECTION_ID));
  assert.equal(harness.calls.length, 1);
});

test('detail and photo permission/backend errors propagate', async () => {
  const denied = Object.assign(new Error('denied'), { code: '42501' });
  const detailHarness = createRpcHarness([{ data: null, error: denied }]);
  await assert.rejects(() => createPreStartsReadAdapter(detailHarness.rpc).getEquipmentInspection(adminScope(), INSPECTION_ID), candidate => candidate === denied);
  const photoHarness = createRpcHarness([{ data: detailPayload(), error: null }, { data: null, error: denied }]);
  await assert.rejects(() => createPreStartsReadAdapter(photoHarness.rpc).getEquipmentInspection(adminScope(), INSPECTION_ID), candidate => candidate === denied);
});

test('job-first Pre-Start route stays verified but never requests company history as Job history', () => {
  const source = readSource('src/components/pre-starts/PreStartJobRecords.jsx');
  assert.match(source, /resolvePreStartJobScope/);
  assert.match(source, /cannot filter inspections by Job/);
  assert.match(source, /No company-wide inspections have been requested/);
  assert.equal(source.includes('onsiteApi'), false);
  assert.equal(source.includes('listEquipmentHistory'), false);
});

test('Equipment integration pins list and detail rendering to current identity, company, role, Equipment and inspection keys', () => {
  const source = readSource('src/components/pre-starts/EquipmentPreStartHistory.jsx');
  assert.match(source, /listResultKey === scopeKey/);
  assert.match(source, /detailResultKey === detailRequestKey/);
  assert.match(source, /requestId !== listRequestRef\.current/);
  assert.match(source, /requestId !== detailRequestRef\.current/);
  assert.match(source, /setItems\(\[\]\)/);
  assert.match(source, /setDetail\(null\)/);
  assert.match(source, /No previous-company or previous-Equipment results are displayed/);
});

test('presentation distinguishes N/A, faults, recorded status and nullable Job without inventing clearance', () => {
  const source = readSource('src/components/pre-starts/EquipmentPreStartHistory.jsx');
  assert.match(source, /Not Applicable — not treated as a satisfactory answer/);
  assert.match(source, /Serious safety fault/);
  assert.match(source, /Minor fault/);
  assert.match(source, /No Job recorded \(valid Equipment-origin inspection\)/);
  assert.match(source, /not a newly calculated operating-clearance decision/);
  assert.match(source, /Only authorised metadata is shown/);
  assert.equal(source.includes('createSignedUrl'), false);
  assert.equal(source.includes('getPublicUrl'), false);
});

test('W04-E surface is read-only with no mutation, export, upload or signed-photo controls', () => {
  const paths = [
    'src/api/supabase/pre-starts-read-adapter.js',
    'src/components/pre-starts/EquipmentPreStartHistory.jsx',
    'src/components/pre-starts/PreStartJobRecords.jsx',
    'src/lib/pre-start-access.js',
  ];
  const combined = paths.map(readSource).join('\n');
  for (const token of ['.insert(', '.update(', '.delete(', '.upload(', 'createSignedUrl', 'startPreStart', 'submitPreStart', 'saveDraft', 'resolveFault', 'Export PDF']) {
    assert.equal(combined.includes(token), false, token);
  }
  assert.equal(combined.includes('service_role'), false);
});

test('previous modules, Equipment movement history and all five job-first routes remain intact', () => {
  const jobPage = readSource('src/pages/JobModuleRecords.jsx');
  assert.match(jobPage, /PurchaseOrderRecords/);
  assert.match(jobPage, /ToolboxTalkRecords/);
  assert.match(jobPage, /SiteDiaryRecords/);
  assert.match(jobPage, /PreStartJobRecords/);
  const equipmentPage = readSource('src/pages/Equipment.jsx');
  assert.match(equipmentPage, /onsiteApi\.equipmentRead\.history/);
  assert.match(equipmentPage, /EquipmentPreStartHistory/);
  assert.equal(DASHBOARD_MODULES.find(module => module.key === 'equipment').path, '/equipment');
  assert.deepEqual(Object.keys(JOB_FIRST_MODULES), ['pre-starts', 'toolbox-talks', 'site-diaries', 'site-photos', 'purchase-orders']);
  for (const moduleKey of Object.keys(JOB_FIRST_MODULES)) {
    assert.equal(getJobRecordsPath(moduleKey, JOB_ID), `/work/${moduleKey}/jobs/${JOB_ID}`);
  }
});

test('Site Photos remains an unavailable shell and W04-A/B/C sources are untouched by integration wiring', () => {
  const jobPage = readSource('src/pages/JobModuleRecords.jsx');
  assert.match(jobPage, /Module integration pending/);
  assert.equal(jobPage.includes("module.key === 'site-photos' ?"), false);
  for (const path of [
    'src/components/purchase-orders/PurchaseOrderRecords.jsx',
    'src/components/toolbox-talks/ToolboxTalkRecords.jsx',
    'src/components/site-diaries/SiteDiaryRecords.jsx',
  ]) assert.ok(readSource(path).length > 100);
});

test('adapter contains only the three approved read RPC names and no direct-table fallback', () => {
  const source = readSource('src/api/supabase/pre-starts-read-adapter.js');
  assert.match(source, /list_company_pre_start_history_admin_v2/);
  assert.match(source, /get_pre_start_inspection_admin/);
  assert.match(source, /list_pre_start_fault_photos/);
  assert.equal(source.includes("from('pre_start"), false);
  assert.equal(source.includes('.from('), false);
});
