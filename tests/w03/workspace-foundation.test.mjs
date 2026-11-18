import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createWorkspaceAdapter,
  normalizeWorkspaceCompanyId,
} from '../../src/api/supabase/workspace-adapter.js';
import {
  COMPANY_STATUS,
  createLatestRequestGuard,
  createWorkspaceSwitchQueue,
  getVisibleWorkspaceState,
  resolveWorkspaceSnapshot,
} from '../../src/lib/workspace-state.js';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const COMPANY_C = '33333333-3333-4333-8333-333333333333';

const row = (companyId, companyName, role, isActive) => ({
  company_id: companyId,
  company_name: companyName,
  role,
  ...(isActive === undefined ? {} : { is_active: isActive }),
});

const workspace = (companyId, companyName, role, isActive) => ({
  companyId,
  companyName,
  role,
  ...(isActive === undefined ? {} : { isActive }),
});

const createRpc = (responses) => {
  const calls = [];
  const rpc = async (...args) => {
    calls.push(args);
    const response = responses[args[0]];
    if (response instanceof Error) return { data: null, error: response };
    return { data: response, error: null };
  };
  return { calls, rpc };
};

const readSource = relativePath => fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('workspace adapter uses the exact native RPC names, argument shape and return fields', async () => {
  const fixture = createRpc({
    list_my_workspaces: [
      row(COMPANY_A, 'Alpha', 'supervisor', false),
      row(COMPANY_B, 'Beta', 'admin', true),
    ],
    get_active_workspace: [row(COMPANY_B, 'Beta', 'admin')],
    set_active_workspace: [row(COMPANY_A, 'Alpha', 'supervisor')],
  });
  const adapter = createWorkspaceAdapter(fixture.rpc);

  assert.deepEqual(await adapter.list(), [
    workspace(COMPANY_A, 'Alpha', 'worker', false),
    workspace(COMPANY_B, 'Beta', 'admin', true),
  ]);
  assert.deepEqual(await adapter.getActive(), workspace(COMPANY_B, 'Beta', 'admin'));
  assert.deepEqual(await adapter.setActive(COMPANY_A.toUpperCase()), workspace(COMPANY_A, 'Alpha', 'worker'));
  assert.deepEqual(fixture.calls, [
    ['list_my_workspaces'],
    ['get_active_workspace'],
    ['set_active_workspace', { p_company_id: COMPANY_A }],
  ]);
});

test('workspace adapter rejects malformed, duplicate or contradictory list output', async () => {
  const malformedLists = [
    {},
    [row('not-a-uuid', 'Alpha', 'worker', true)],
    [row(COMPANY_A, '', 'worker', true)],
    [row(COMPANY_A, 'Alpha', '', true)],
    [row(COMPANY_A, 'Alpha', 'worker')],
    [row(COMPANY_A, 'Alpha', 'worker', true), row(COMPANY_A, 'Alpha', 'worker', false)],
    [row(COMPANY_A, 'Alpha', 'worker', true), row(COMPANY_B, 'Beta', 'admin', true)],
  ];

  for (const list of malformedLists) {
    const adapter = createWorkspaceAdapter(createRpc({ list_my_workspaces: list }).rpc);
    await assert.rejects(() => adapter.list(), /invalid workspace response/);
  }
});

test('workspace adapter rejects malformed active/set results and invalid caller IDs', async () => {
  const multipleActiveRows = createWorkspaceAdapter(createRpc({
    get_active_workspace: [row(COMPANY_A, 'Alpha', 'worker'), row(COMPANY_B, 'Beta', 'admin')],
  }).rpc);
  await assert.rejects(() => multipleActiveRows.getActive(), /invalid workspace response/);

  const mismatchedSet = createWorkspaceAdapter(createRpc({
    set_active_workspace: [row(COMPANY_B, 'Beta', 'admin')],
  }).rpc);
  await assert.rejects(() => mismatchedSet.setActive(COMPANY_A), /invalid workspace response/);
  await assert.rejects(() => mismatchedSet.setActive('not-a-company'), /Supabase UUID/);
  assert.throws(() => normalizeWorkspaceCompanyId(''), /Supabase UUID/);
});

test('workspace adapter propagates backend rejection without converting it into authorisation', async () => {
  const backendError = Object.assign(new Error('Company membership required'), { code: '42501' });
  const adapter = createWorkspaceAdapter(createRpc({ set_active_workspace: backendError }).rpc);
  await assert.rejects(() => adapter.setActive(COMPANY_C), error => error === backendError);
});

test('zero workspaces resolves to a fail-closed no-membership state', () => {
  const state = resolveWorkspaceSnapshot({ workspaces: [], activeWorkspace: null, userId: USER_A });
  assert.equal(state.status, COMPANY_STATUS.NO_MEMBERSHIP);
  assert.equal(state.company, null);
  assert.equal(state.membership, null);
});

test('one workspace resolves only when the authoritative active response agrees', () => {
  const state = resolveWorkspaceSnapshot({
    workspaces: [workspace(COMPANY_A, 'Alpha', 'owner', true)],
    activeWorkspace: workspace(COMPANY_A, 'Alpha', 'owner'),
    userId: USER_A,
  });
  assert.equal(state.status, COMPANY_STATUS.READY);
  assert.deepEqual(state.company, { id: COMPANY_A, name: 'Alpha' });
  assert.deepEqual(state.membership, { company_id: COMPANY_A, user_id: USER_A, role: 'owner' });
});

test('multiple workspaces without a preference require an explicit selection', () => {
  const workspaces = [
    workspace(COMPANY_A, 'Alpha', 'worker', false),
    workspace(COMPANY_B, 'Beta', 'admin', false),
  ];
  const state = resolveWorkspaceSnapshot({ workspaces, activeWorkspace: null, userId: USER_A });
  assert.equal(state.status, COMPANY_STATUS.SELECTION_REQUIRED);
  assert.equal(state.company, null);
  assert.deepEqual(state.workspaces, workspaces);
});

test('multiple workspaces resolve the selected company and company-specific role', () => {
  const state = resolveWorkspaceSnapshot({
    workspaces: [
      workspace(COMPANY_A, 'Alpha', 'worker', false),
      workspace(COMPANY_B, 'Beta', 'admin', true),
    ],
    activeWorkspace: workspace(COMPANY_B, 'Beta', 'admin'),
    userId: USER_A,
  });
  assert.equal(state.company.id, COMPANY_B);
  assert.equal(state.membership.role, 'admin');
});

test('stale, unauthorised or inconsistent active workspace output fails closed', () => {
  const authorised = [workspace(COMPANY_A, 'Alpha', 'worker', true)];
  assert.throws(() => resolveWorkspaceSnapshot({
    workspaces: authorised,
    activeWorkspace: workspace(COMPANY_C, 'Gamma', 'owner'),
    userId: USER_A,
  }), /no longer authorised/);
  assert.throws(() => resolveWorkspaceSnapshot({
    workspaces: [workspace(COMPANY_A, 'Alpha', 'worker', false)],
    activeWorkspace: null,
    userId: USER_A,
  }), /inconsistent/);
  assert.throws(() => resolveWorkspaceSnapshot({
    workspaces: authorised,
    activeWorkspace: workspace(COMPANY_A, 'Changed name', 'worker'),
    userId: USER_A,
  }), /no longer authorised/);
});

test('sign-out and authentication identity changes hide the previous workspace immediately', () => {
  const readyState = resolveWorkspaceSnapshot({
    workspaces: [workspace(COMPANY_A, 'Alpha', 'owner', true)],
    activeWorkspace: workspace(COMPANY_A, 'Alpha', 'owner'),
    userId: USER_A,
  });

  const signedOut = getVisibleWorkspaceState({
    state: readyState,
    userId: null,
    isAuthenticated: false,
    isLoadingAuth: false,
  });
  assert.equal(signedOut.status, COMPANY_STATUS.UNAUTHENTICATED);
  assert.equal(signedOut.company, null);

  const changedIdentity = getVisibleWorkspaceState({
    state: readyState,
    userId: USER_B,
    isAuthenticated: true,
    isLoadingAuth: false,
  });
  assert.equal(changedIdentity.status, COMPANY_STATUS.LOADING);
  assert.equal(changedIdentity.company, null);
  assert.equal(changedIdentity.membership, null);
});

test('latest-request guard rejects stale in-flight workspace responses', () => {
  const guard = createLatestRequestGuard();
  const first = guard.begin();
  const second = guard.begin();
  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(second), false);
});

test('workspace switches are serialised so the latest user choice is applied last', async () => {
  const queue = createWorkspaceSwitchQueue();
  const events = [];
  let releaseFirst;
  const firstWait = new Promise(resolve => { releaseFirst = resolve; });

  const first = queue.enqueue(async () => {
    events.push('first:start');
    await firstWait;
    events.push('first:end');
  });
  const second = queue.enqueue(async () => {
    events.push('second:start');
    events.push('second:end');
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['first:start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
});

test('a rejected switch does not prevent a later authorised switch', async () => {
  const queue = createWorkspaceSwitchQueue();
  const first = queue.enqueue(async () => { throw new Error('rejected'); });
  const second = queue.enqueue(async () => COMPANY_B);
  await assert.rejects(() => first, /rejected/);
  assert.equal(await second, COMPANY_B);
});

test('CompanyProvider uses workspace RPCs, clears shared cache and removes direct membership queries', () => {
  const source = readSource('src/lib/companyContext.jsx');
  assert.match(source, /onsiteApi\.workspaces\.list\(\)/);
  assert.match(source, /onsiteApi\.workspaces\.getActive\(\)/);
  assert.match(source, /onsiteApi\.workspaces\.setActive\(normalizedCompanyId\)/);
  assert.match(source, /queryClient\.clear\(\)/);
  assert.match(source, /createWorkspaceSwitchQueue/);
  assert.equal(source.includes('tables.companyMembers.filter'), false);
  assert.equal(source.includes('tables.companies.filter'), false);
});

test('workspace selection and switching preserve the dashboard and job-first route foundation', () => {
  const app = readSource('src/App.jsx');
  const layout = readSource('src/components/Layout.jsx');
  const dashboard = readSource('src/pages/Dashboard.jsx');
  const jobs = readSource('src/pages/Jobs.jsx');

  assert.match(app, /workspace_selection_required/);
  assert.match(app, /Authorised company workspaces/);
  assert.match(app, /path="\/work\/:moduleKey\/jobs"/);
  assert.match(app, /path="\/work\/:moduleKey\/jobs\/:jobId"/);
  assert.match(layout, /aria-label="Active company workspace"/);
  assert.match(layout, /DASHBOARD_MODULES\.map/);
  assert.match(dashboard, /getMyActive\(company\.id\)/);
  assert.equal(dashboard.includes('tables.companies.list'), false);
  assert.match(jobs, /resolveJobReadScope/);
  assert.match(jobs, /onsiteApi\.jobs\.list\(jobScope\.companyId\)/);
  assert.match(jobs, /getJobRecordsPath\(jobModule\.key, job\.id\)/);
  assert.equal(jobs.includes('tables.companies.list'), false);
});
