import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createEquipmentReadAdapter,
  EQUIPMENT_HISTORY_FIELDS,
  EQUIPMENT_REGISTER_FIELDS,
  mapEquipmentHistoryRow,
  mapEquipmentRegisterRow,
} from '../../src/api/supabase/equipment-read-adapter.js';
import {
  createEquipmentScopeKey,
  equipmentHistoryActionLabel,
  equipmentStatusLabel,
  resolveEquipmentReadScope,
} from '../../src/lib/equipment-access.js';
import { DASHBOARD_MODULES, getJobRecordsPath, JOB_FIRST_MODULES } from '../../src/navigation/dashboard-modules.js';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const EQUIPMENT_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_EQUIPMENT_ID = '44444444-4444-4444-8444-444444444444';
const MOVEMENT_ID = '55555555-5555-4555-8555-555555555555';
const JOB_ID = '66666666-6666-4666-8666-666666666666';

const equipmentRow = (overrides = {}) => ({
  id: EQUIPMENT_ID,
  company_id: COMPANY_ID,
  name: ' Excavator ',
  equipment_id: ' EX-01 ',
  category: 'machinery',
  status: 'available',
  checked_out_by_id: null,
  checked_out_by_name: null,
  checked_out_at: null,
  notes: ' Site machine ',
  requires_pre_start: true,
  retired_at: null,
  ...overrides,
});

const historyRow = (overrides = {}) => ({
  id: MOVEMENT_ID,
  company_id: COMPANY_ID,
  equipment_id: EQUIPMENT_ID,
  equipment_name: ' Excavator ',
  worker_id: USER_ID,
  worker_name: ' Worker One ',
  action: 'checked_out',
  timestamp: '2026-11-19T00:00:00.000Z',
  notes: null,
  ...overrides,
});

const createFromHarness = (response) => {
  const calls = [];
  const from = table => {
    calls.push(['from', table]);
    const query = {
      select: (...args) => { calls.push(['select', ...args]); return query; },
      eq: (...args) => { calls.push(['eq', ...args]); return query; },
      is: (...args) => { calls.push(['is', ...args]); return query; },
      order: (...args) => { calls.push(['order', ...args]); return query; },
      range: (...args) => { calls.push(['range', ...args]); return query; },
      maybeSingle: () => { calls.push(['maybeSingle']); return query; },
      then: (resolve, reject) => Promise.resolve(response).then(resolve, reject),
    };
    return query;
  };
  return { calls, from };
};

const readSource = relativePath => fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('register list uses only the confirmed active-company field and ordering contract', async () => {
  const harness = createFromHarness({ data: [equipmentRow()], error: null });
  const items = await createEquipmentReadAdapter(harness.from).list(COMPANY_ID.toUpperCase());
  assert.deepEqual(items, [{
    id: EQUIPMENT_ID,
    company_id: COMPANY_ID,
    name: 'Excavator',
    equipment_id: 'EX-01',
    category: 'machinery',
    status: 'available',
    checked_out_by_id: null,
    checked_out_by_name: null,
    checked_out_at: null,
    notes: 'Site machine',
    requires_pre_start: true,
    retired_at: null,
  }]);
  assert.deepEqual(harness.calls, [
    ['from', 'equipment'],
    ['select', EQUIPMENT_REGISTER_FIELDS],
    ['eq', 'company_id', COMPANY_ID],
    ['is', 'retired_at', null],
    ['order', 'name', { ascending: true }],
    ['order', 'equipment_id', { ascending: true }],
  ]);
});

test('empty and null register responses remain empty', async () => {
  for (const data of [[], null]) {
    assert.deepEqual(await createEquipmentReadAdapter(createFromHarness({ data, error: null }).from).list(COMPANY_ID), []);
  }
});

test('register mapping fails closed for malformed, unsupported and cross-company records', async () => {
  const invalidRows = [
    equipmentRow({ company_id: OTHER_COMPANY_ID }),
    equipmentRow({ category: 'plant' }),
    equipmentRow({ status: 'lost' }),
    equipmentRow({ requires_pre_start: 'yes' }),
    equipmentRow({ checked_out_at: 'not-a-date' }),
    equipmentRow({ retired_at: undefined }),
  ];
  for (const row of invalidRows) {
    await assert.rejects(() => createEquipmentReadAdapter(createFromHarness({ data: [row], error: null }).from).list(COMPANY_ID));
  }
  assert.throws(() => mapEquipmentRegisterRow(null, COMPANY_ID), /invalid item/);
});

test('retired records are excluded without altering their stored status', async () => {
  const row = equipmentRow({ status: 'maintenance', retired_at: '2026-11-18T00:00:00Z' });
  const adapter = createEquipmentReadAdapter(createFromHarness({ data: [row], error: null }).from);
  assert.deepEqual(await adapter.list(COMPANY_ID), []);
  assert.equal(row.status, 'maintenance');
});

test('register permission denial and general failures propagate without fabricated results', async () => {
  for (const error of [Object.assign(new Error('denied'), { code: '42501' }), new Error('offline')]) {
    const adapter = createEquipmentReadAdapter(createFromHarness({ data: null, error }).from);
    await assert.rejects(() => adapter.list(COMPANY_ID), candidate => candidate === error);
  }
});

test('detail lookup pins both company and item and excludes retired equipment', async () => {
  const harness = createFromHarness({ data: equipmentRow(), error: null });
  const item = await createEquipmentReadAdapter(harness.from).get(COMPANY_ID, EQUIPMENT_ID);
  assert.equal(item.id, EQUIPMENT_ID);
  assert.deepEqual(harness.calls, [
    ['from', 'equipment'],
    ['select', EQUIPMENT_REGISTER_FIELDS],
    ['eq', 'company_id', COMPANY_ID],
    ['eq', 'id', EQUIPMENT_ID],
    ['is', 'retired_at', null],
    ['maybeSingle'],
  ]);
});

test('missing detail stays unavailable and mismatched detail fails closed', async () => {
  const missing = createEquipmentReadAdapter(createFromHarness({ data: null, error: null }).from);
  assert.equal(await missing.get(COMPANY_ID, EQUIPMENT_ID), null);
  const mismatch = createEquipmentReadAdapter(createFromHarness({ data: equipmentRow({ id: OTHER_EQUIPMENT_ID }), error: null }).from);
  await assert.rejects(() => mismatch.get(COMPANY_ID, EQUIPMENT_ID), /invalid item/);
});

test('admin and owner history uses company scope, newest-first order and a 25-row boundary', async () => {
  for (const role of ['admin', 'owner']) {
    const harness = createFromHarness({ data: [historyRow()], error: null });
    const result = await createEquipmentReadAdapter(harness.from).history({ companyId: COMPANY_ID, userId: ADMIN_ID, role });
    assert.equal(result.items.length, 1);
    assert.equal(result.has_more, false);
    assert.deepEqual(harness.calls, [
      ['from', 'equipment_logs'],
      ['select', EQUIPMENT_HISTORY_FIELDS],
      ['eq', 'company_id', COMPANY_ID],
      ['order', 'timestamp', { ascending: false }],
      ['order', 'id', { ascending: false }],
      ['range', 0, 24],
    ]);
  }
});

test('worker and historical supervisor history is additionally self-scoped', async () => {
  for (const role of ['worker', 'supervisor']) {
    const harness = createFromHarness({ data: [historyRow()], error: null });
    await createEquipmentReadAdapter(harness.from).history({ companyId: COMPANY_ID, userId: USER_ID, role });
    assert.ok(harness.calls.some(call => call[0] === 'eq' && call[1] === 'worker_id' && call[2] === USER_ID));
  }
});

test('history mapping validates timestamps/actions and exposes no sensitive audit fields', () => {
  const movement = mapEquipmentHistoryRow(historyRow({
    worker_email: 'private@example.invalid',
    actor_email: 'private@example.invalid',
    override_reason: 'private',
  }), COMPANY_ID);
  assert.deepEqual(Object.keys(movement), ['id', 'company_id', 'equipment_id', 'equipment_name', 'worker_id', 'worker_name', 'action', 'timestamp', 'notes']);
  assert.throws(() => mapEquipmentHistoryRow(historyRow({ timestamp: 'invalid' }), COMPANY_ID), /invalid timestamp/);
  assert.throws(() => mapEquipmentHistoryRow(historyRow({ action: 'deleted' }), COMPANY_ID), /invalid action/);
});

test('equipment labels are display-only and preserve canonical identifiers', () => {
  assert.equal(equipmentStatusLabel('checked_out'), 'Checked out');
  assert.equal(equipmentHistoryActionLabel('force_returned'), 'Force returned');
  assert.equal(historyRow().action, 'checked_out');
  assert.equal(equipmentRow().status, 'available');
});

test('equipment scope requires matching authentication, company, membership and approved role', () => {
  const company = { id: COMPANY_ID, name: 'Alpha' };
  const membership = { company_id: COMPANY_ID, user_id: USER_ID, role: 'worker' };
  assert.equal(resolveEquipmentReadScope({ userId: null, company, membership }), null);
  assert.equal(resolveEquipmentReadScope({ userId: USER_ID, company: null, membership }), null);
  assert.equal(resolveEquipmentReadScope({ userId: USER_ID, company, membership: { ...membership, company_id: OTHER_COMPANY_ID } }), null);
  assert.equal(resolveEquipmentReadScope({ userId: ADMIN_ID, company, membership }), null);
  assert.equal(resolveEquipmentReadScope({ userId: USER_ID, company, membership: { ...membership, role: 'manager' } }), null);
  assert.deepEqual(resolveEquipmentReadScope({ userId: USER_ID, company, membership }), {
    userId: USER_ID,
    companyId: COMPANY_ID,
    companyName: 'Alpha',
    role: 'worker',
  });
  assert.equal(resolveEquipmentReadScope({ userId: USER_ID, company, membership: { ...membership, role: 'supervisor' } }).role, 'worker');
});

test('identity, workspace and role changes produce distinct equipment request identities', () => {
  const base = { userId: USER_ID, companyId: COMPANY_ID, companyName: 'Alpha', role: 'worker' };
  assert.notEqual(createEquipmentScopeKey(base), createEquipmentScopeKey({ ...base, userId: ADMIN_ID }));
  assert.notEqual(createEquipmentScopeKey(base), createEquipmentScopeKey({ ...base, companyId: OTHER_COMPANY_ID }));
  assert.notEqual(createEquipmentScopeKey(base), createEquipmentScopeKey({ ...base, role: 'admin' }));
  assert.equal(createEquipmentScopeKey(null), null);
});

test('Equipment page pins register, detail and history results to current request scope', () => {
  const page = readSource('src/pages/Equipment.jsx');
  assert.match(page, /onsiteApi\.equipmentRead\.list\(equipmentScope\.companyId\)/);
  assert.match(page, /onsiteApi\.equipmentRead\.get\(equipmentScope\.companyId, selectedEquipmentId\)/);
  assert.match(page, /onsiteApi\.equipmentRead\.history/);
  assert.match(page, /registerScopeKey === equipmentScopeKey/);
  assert.match(page, /detailResultKey === selectedResultKey/);
  assert.match(page, /historyScopeKey === equipmentScopeKey/);
  assert.match(page, /requestId !== registerRequestIdRef\.current/);
  assert.match(page, /requestId !== detailRequestIdRef\.current/);
  assert.match(page, /requestId !== historyRequestIdRef\.current/);
  assert.match(page, /No previous-company records are displayed/);
});

test('Equipment integration is read-only with no mutation, photo or administration surface', () => {
  const page = readSource('src/pages/Equipment.jsx');
  const adapter = readSource('src/api/supabase/equipment-read-adapter.js');
  const combined = `${page}\n${adapter}`;
  for (const token of ['.insert(', '.update(', '.delete(', '.upload(', 'checkout(', 'returnEquipment(', 'createAdmin', 'updateAdmin', 'deleteAdmin', 'replacePhotoAdmin', 'clearPhotoAdmin']) {
    assert.equal(combined.includes(token), false, token);
  }
  assert.equal(page.includes('photo_path'), false);
  assert.match(page, /requires_pre_start/);
  assert.match(page, /checked_out_by_name/);
  assert.match(page, /Showing the newest 25 movements/);
});

test('Equipment dashboard, Team, Jobs and five job-first routes remain intact', () => {
  assert.equal(DASHBOARD_MODULES.find(module => module.key === 'equipment').path, '/equipment');
  assert.deepEqual(Object.keys(JOB_FIRST_MODULES), ['pre-starts', 'toolbox-talks', 'site-diaries', 'site-photos', 'purchase-orders']);
  for (const moduleKey of Object.keys(JOB_FIRST_MODULES)) {
    assert.equal(getJobRecordsPath(moduleKey, JOB_ID), `/work/${moduleKey}/jobs/${JOB_ID}`);
  }
  const app = readSource('src/App.jsx');
  assert.match(app, /path="\/equipment" element={<Equipment \/>}/);
  assert.match(readSource('src/pages/Jobs.jsx'), /onsiteApi\.jobs\.list\(jobScope\.companyId\)/);
  assert.match(readSource('src/pages/Team.jsx'), /onsiteApi\.teamDirectory\.list\(teamScope\.companyId\)/);
});
