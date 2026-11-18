import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createTeamDirectoryReadAdapter,
  mapTeamDirectoryRow,
  normalizeTeamRole,
} from '../../src/api/supabase/team-directory-read-adapter.js';
import {
  createTeamScopeKey,
  resolveTeamReadScope,
} from '../../src/lib/team-access.js';
import {
  DASHBOARD_MODULES,
  getJobRecordsPath,
  JOB_FIRST_MODULES,
} from '../../src/navigation/dashboard-modules.js';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const ADMIN_MEMBER_ID = '44444444-4444-4444-8444-444444444444';
const JOB_ID = '55555555-5555-4555-8555-555555555555';

const teamRow = (overrides = {}) => ({
  member_id: MEMBER_ID,
  user_id: USER_ID,
  full_name: ' Team Worker ',
  email: ' worker@example.invalid ',
  phone: ' 0400000000 ',
  role: 'worker',
  ...overrides,
});

const createRpcHarness = (response) => {
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

test('Team adapter calls only get_company_team with the active company and maps approved fields', async () => {
  const harness = createRpcHarness({ data: [teamRow()], error: null });
  const adapter = createTeamDirectoryReadAdapter(harness.rpc);

  assert.deepEqual(await adapter.list(COMPANY_ID.toUpperCase()), [{
    member_id: MEMBER_ID,
    user_id: USER_ID,
    full_name: 'Team Worker',
    email: 'worker@example.invalid',
    phone: '0400000000',
    role: 'worker',
  }]);
  assert.deepEqual(harness.calls, [[
    'get_company_team',
    { p_company_id: COMPANY_ID },
  ]]);
});

test('Team adapter preserves backend order, including the current-user-first contract', async () => {
  const harness = createRpcHarness({
    data: [
      teamRow(),
      teamRow({ member_id: ADMIN_MEMBER_ID, user_id: ADMIN_ID, full_name: 'Alpha Admin', role: 'admin' }),
    ],
    error: null,
  });
  const members = await createTeamDirectoryReadAdapter(harness.rpc).list(COMPANY_ID);
  assert.deepEqual(members.map(member => member.user_id), [USER_ID, ADMIN_ID]);
});

test('empty and null Team RPC results remain an empty directory', async () => {
  for (const data of [[], null]) {
    const adapter = createTeamDirectoryReadAdapter(createRpcHarness({ data, error: null }).rpc);
    assert.deepEqual(await adapter.list(COMPANY_ID), []);
  }
});

test('malformed Team output and unsupported roles fail closed', async () => {
  const malformed = [
    { data: {}, error: null },
    { data: [teamRow({ member_id: 'invalid' })], error: null },
    { data: [teamRow({ email: 42 })], error: null },
    { data: [teamRow({ role: 'manager' })], error: null },
  ];

  for (const response of malformed) {
    const adapter = createTeamDirectoryReadAdapter(createRpcHarness(response).rpc);
    await assert.rejects(() => adapter.list(COMPANY_ID));
  }
  assert.throws(() => mapTeamDirectoryRow(null), /invalid member/);
});

test('RPC permission denial and general failures propagate without fabricated results', async () => {
  for (const error of [
    Object.assign(new Error('Team directory is only available to company members'), { code: '42501' }),
    new Error('network unavailable'),
  ]) {
    const adapter = createTeamDirectoryReadAdapter(createRpcHarness({ data: null, error }).rpc);
    await assert.rejects(() => adapter.list(COMPANY_ID), candidate => candidate === error);
  }
});

test('supported role mapping normalizes historical supervisor to Worker only', () => {
  assert.equal(normalizeTeamRole('owner'), 'owner');
  assert.equal(normalizeTeamRole('admin'), 'admin');
  assert.equal(normalizeTeamRole('worker'), 'worker');
  assert.equal(normalizeTeamRole('supervisor'), 'worker');
  assert.throws(() => normalizeTeamRole('manager'), /invalid member/);
});

test('the adapter exposes only RPC-approved directory fields and no membership-status alias', () => {
  const member = mapTeamDirectoryRow(teamRow({
    is_active: true,
    private_metadata: 'not permitted',
  }));
  assert.deepEqual(Object.keys(member), [
    'member_id',
    'user_id',
    'full_name',
    'email',
    'phone',
    'role',
  ]);
});

test('unauthenticated and missing-workspace states cannot form a Team read scope', () => {
  const company = { id: COMPANY_ID, name: 'Alpha' };
  const membership = { company_id: COMPANY_ID, user_id: USER_ID, role: 'worker' };
  assert.equal(resolveTeamReadScope({ userId: null, company, membership }), null);
  assert.equal(resolveTeamReadScope({ userId: USER_ID, company: null, membership }), null);
  assert.equal(resolveTeamReadScope({ userId: USER_ID, company, membership: null }), null);
});

test('Team scope requires matching user, company and approved product role', () => {
  const company = { id: COMPANY_ID, name: 'Alpha' };
  const membership = { company_id: COMPANY_ID, user_id: USER_ID, role: 'worker' };
  const scope = resolveTeamReadScope({ userId: USER_ID, company, membership });
  assert.deepEqual(scope, {
    userId: USER_ID,
    companyId: COMPANY_ID,
    companyName: 'Alpha',
    role: 'worker',
  });
  assert.equal(resolveTeamReadScope({
    userId: USER_ID,
    company,
    membership: { ...membership, company_id: OTHER_COMPANY_ID },
  }), null);
  assert.equal(resolveTeamReadScope({
    userId: ADMIN_ID,
    company,
    membership,
  }), null);
  assert.equal(resolveTeamReadScope({
    userId: USER_ID,
    company,
    membership: { ...membership, role: 'supervisor' },
  }), null);
});

test('workers, admins and owners share the same read-only directory field contract', () => {
  const company = { id: COMPANY_ID, name: 'Alpha' };
  for (const role of ['worker', 'admin', 'owner']) {
    const scope = resolveTeamReadScope({
      userId: USER_ID,
      company,
      membership: { company_id: COMPANY_ID, user_id: USER_ID, role },
    });
    assert.equal(scope.role, role);
  }

  const source = readSource('src/pages/Team.jsx');
  assert.match(source, /member\.full_name/);
  assert.match(source, /member\.email/);
  assert.match(source, /member\.phone/);
  assert.equal(source.includes('canAdministerTeam'), false);
});

test('workspace and authentication changes produce distinct Team request identities', () => {
  const base = { userId: USER_ID, companyId: COMPANY_ID, companyName: 'Alpha', role: 'worker' };
  assert.notEqual(createTeamScopeKey(base), createTeamScopeKey({ ...base, userId: ADMIN_ID }));
  assert.notEqual(createTeamScopeKey(base), createTeamScopeKey({ ...base, companyId: OTHER_COMPANY_ID }));
  assert.notEqual(createTeamScopeKey(base), createTeamScopeKey({ ...base, role: 'admin' }));
  assert.equal(createTeamScopeKey(null), null);
});

test('Team page hides stale records synchronously and rejects out-of-order responses', () => {
  const source = readSource('src/pages/Team.jsx');
  assert.match(source, /resolveTeamReadScope/);
  assert.match(source, /onsiteApi\.teamDirectory\.list\(teamScope\.companyId\)/);
  assert.match(source, /resultScopeKey === teamScopeKey/);
  assert.match(source, /hasCurrentResult \? members : \[\]/);
  assert.match(source, /setMembers\(\[\]\)/);
  assert.match(source, /requestId !== requestIdRef\.current/);
  assert.match(source, /requestIdRef\.current \+= 1/);
  assert.match(source, /No previous-company records are displayed/);
});

test('Team integration has no direct profile/member reads or administration actions', () => {
  const page = readSource('src/pages/Team.jsx');
  const adapter = readSource('src/api/supabase/team-directory-read-adapter.js');
  const combined = `${page}\n${adapter}`;
  assert.equal(combined.includes("from('profiles')"), false);
  assert.equal(combined.includes("from('company_members')"), false);
  assert.equal(combined.includes('.insert('), false);
  assert.equal(combined.includes('.update('), false);
  assert.equal(combined.includes('.delete('), false);
  assert.equal(combined.includes('invite'), false);
  assert.equal(combined.includes('changeRole'), false);
});

test('Team dashboard navigation, Jobs integration and all job-first routes remain intact', () => {
  const teamModule = DASHBOARD_MODULES.find(module => module.key === 'team');
  assert.equal(teamModule.path, '/team');
  assert.deepEqual(Object.keys(JOB_FIRST_MODULES), [
    'pre-starts',
    'toolbox-talks',
    'site-diaries',
    'site-photos',
    'purchase-orders',
  ]);
  for (const moduleKey of Object.keys(JOB_FIRST_MODULES)) {
    assert.equal(getJobRecordsPath(moduleKey, JOB_ID), `/work/${moduleKey}/jobs/${JOB_ID}`);
  }

  const app = readSource('src/App.jsx');
  const jobs = readSource('src/pages/Jobs.jsx');
  assert.match(app, /path="\/team" element={<Team \/>}/);
  assert.match(jobs, /onsiteApi\.jobs\.list\(jobScope\.companyId\)/);
});
