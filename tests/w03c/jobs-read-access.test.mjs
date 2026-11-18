import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createJobsReadAdapter,
  JOB_READ_FIELDS,
  mapCompanyJobRow,
} from '../../src/api/supabase/jobs-read-adapter.js';
import {
  canManageJobs,
  createJobScopeKey,
  resolveJobReadScope,
} from '../../src/lib/job-access.js';
import {
  getJobRecordsPath,
  JOB_FIRST_MODULES,
} from '../../src/navigation/dashboard-modules.js';
import { formatJobStatusLabel } from '../../src/pages/job-status.js';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const UNKNOWN_JOB_ID = '44444444-4444-4444-8444-444444444444';

const jobRow = (overrides = {}) => ({
  id: JOB_ID,
  company_id: COMPANY_ID,
  job_name: ' Harbour Project ',
  job_number: ' JOB-001 ',
  location_address: ' 1 Test Street ',
  latitude: -33.86,
  longitude: 151.2,
  notes: ' Site notes ',
  status: 'active',
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-02T00:00:00.000Z',
  ...overrides,
});

const createQueryHarness = ({ listData = [], detailData = null, listError = null, detailError = null } = {}) => {
  const calls = [];
  const query = {
    select(fields) {
      calls.push(['select', fields]);
      return this;
    },
    eq(column, value) {
      calls.push(['eq', column, value]);
      return this;
    },
    async order(column, options) {
      calls.push(['order', column, options]);
      return { data: listData, error: listError };
    },
    async maybeSingle() {
      calls.push(['maybeSingle']);
      return { data: detailData, error: detailError };
    },
  };
  return {
    calls,
    from(tableName) {
      calls.push(['from', tableName]);
      return query;
    },
  };
};

const readSource = relativePath => fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('Jobs list uses the exact native fields, active company filter and newest-first order', async () => {
  const harness = createQueryHarness({ listData: [jobRow()] });
  const adapter = createJobsReadAdapter(harness.from);
  const jobs = await adapter.list(COMPANY_ID);

  assert.deepEqual(harness.calls, [
    ['from', 'jobs'],
    ['select', JOB_READ_FIELDS],
    ['eq', 'company_id', COMPANY_ID],
    ['order', 'created_at', { ascending: false }],
  ]);
  assert.deepEqual(jobs, [{
    id: JOB_ID,
    company_id: COMPANY_ID,
    job_name: 'Harbour Project',
    job_number: 'JOB-001',
    location_address: '1 Test Street',
    latitude: -33.86,
    longitude: 151.2,
    notes: 'Site notes',
    status: 'active',
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-02T00:00:00.000Z',
  }]);
});

test('Jobs list supports only the confirmed status identifiers', async () => {
  const harness = createQueryHarness();
  const adapter = createJobsReadAdapter(harness.from);
  await adapter.list(COMPANY_ID, 'on_hold');
  assert.deepEqual(harness.calls[3], ['eq', 'status', 'on_hold']);

  await assert.rejects(() => adapter.list(COMPANY_ID, 'archived'), /active, on_hold, or completed/);
});

test('empty Jobs results remain empty and backend errors propagate', async () => {
  const emptyAdapter = createJobsReadAdapter(createQueryHarness({ listData: null }).from);
  assert.deepEqual(await emptyAdapter.list(COMPANY_ID), []);

  const failure = new Error('read failed');
  const failedAdapter = createJobsReadAdapter(createQueryHarness({ listError: failure }).from);
  await assert.rejects(() => failedAdapter.list(COMPANY_ID), error => error === failure);
});

test('malformed Jobs rows, unexpected statuses and cross-company rows fail closed', () => {
  assert.throws(() => mapCompanyJobRow(jobRow({ job_name: '  ' }), COMPANY_ID), /invalid job/);
  assert.throws(() => mapCompanyJobRow(jobRow({ status: 'archived' }), COMPANY_ID), /invalid job/);
  assert.throws(() => mapCompanyJobRow(jobRow({ company_id: OTHER_COMPANY_ID }), COMPANY_ID), /invalid job/);
  assert.throws(() => mapCompanyJobRow(jobRow({ latitude: 'not-a-number' }), COMPANY_ID), /invalid job/);
});

test('job detail requires both company and job filters before maybeSingle', async () => {
  const harness = createQueryHarness({ detailData: jobRow() });
  const adapter = createJobsReadAdapter(harness.from);
  const job = await adapter.get(COMPANY_ID, JOB_ID);

  assert.equal(job.id, JOB_ID);
  assert.deepEqual(harness.calls, [
    ['from', 'jobs'],
    ['select', JOB_READ_FIELDS],
    ['eq', 'company_id', COMPANY_ID],
    ['eq', 'id', JOB_ID],
    ['maybeSingle'],
  ]);
});

test('unknown and cross-company job identifiers produce no authorised detail', async () => {
  const unknownAdapter = createJobsReadAdapter(createQueryHarness({ detailData: null }).from);
  assert.equal(await unknownAdapter.get(COMPANY_ID, UNKNOWN_JOB_ID), null);

  const crossCompanyAdapter = createJobsReadAdapter(createQueryHarness({
    detailData: jobRow({ company_id: OTHER_COMPANY_ID }),
  }).from);
  await assert.rejects(() => crossCompanyAdapter.get(COMPANY_ID, JOB_ID), /invalid job/);
});

test('missing authentication, workspace or matching membership cannot form a read scope', () => {
  const company = { id: COMPANY_ID, name: 'Alpha' };
  const membership = { company_id: COMPANY_ID, user_id: USER_ID, role: 'worker' };
  assert.equal(resolveJobReadScope({ userId: null, company, membership }), null);
  assert.equal(resolveJobReadScope({ userId: USER_ID, company: null, membership }), null);
  assert.equal(resolveJobReadScope({ userId: USER_ID, company, membership: null }), null);
  assert.equal(resolveJobReadScope({
    userId: USER_ID,
    company,
    membership: { ...membership, company_id: OTHER_COMPANY_ID },
  }), null);
});

test('worker, admin and owner scopes preserve read access while only admin roles can manage', () => {
  const company = { id: COMPANY_ID, name: 'Alpha' };
  for (const role of ['worker', 'admin', 'owner']) {
    const scope = resolveJobReadScope({
      userId: USER_ID,
      company,
      membership: { company_id: COMPANY_ID, user_id: USER_ID, role },
    });
    assert.equal(scope.role, role);
    assert.equal(canManageJobs(scope), role !== 'worker');
  }
  assert.equal(resolveJobReadScope({
    userId: USER_ID,
    company,
    membership: { company_id: COMPANY_ID, user_id: USER_ID, role: 'supervisor' },
  }), null);
});

test('workspace, user and role changes produce distinct cache/request scope identities', () => {
  const base = { userId: USER_ID, companyId: COMPANY_ID, companyName: 'Alpha', role: 'worker' };
  assert.notEqual(createJobScopeKey(base), createJobScopeKey({ ...base, companyId: OTHER_COMPANY_ID }));
  assert.notEqual(createJobScopeKey(base), createJobScopeKey({ ...base, role: 'admin' }));
  assert.equal(createJobScopeKey(null), null);
});

test('Jobs page uses the active scope, clears old records and gates mutation controls', () => {
  const source = readSource('src/pages/Jobs.jsx');
  assert.match(source, /resolveJobReadScope/);
  assert.match(source, /onsiteApi\.jobs\.list\(jobScope\.companyId\)/);
  assert.match(source, /setJobs\(\[\]\)/);
  assert.match(source, /loadedScopeKey === jobScopeKey/);
  assert.match(source, /hasCurrentJobState \? jobs : \[\]/);
  assert.match(source, /canManage && showAddModal/);
  assert.match(source, /canManage && editJob/);
  assert.equal(source.includes('tables.companies.list'), false);
  assert.equal(source.includes('tables.jobs.delete'), false);
  assert.equal(source.includes('handleDelete'), false);
});

test('legacy Admin Jobs UI has no hard-delete handler or invocation', () => {
  const source = readSource('src/pages/Admin.jsx');
  assert.equal(source.includes('handleDeleteJob'), false);
  assert.equal(source.includes('tables.jobs.delete'), false);
  assert.equal(source.includes('deleteSavingId'), false);
});

test('adapter hard-delete method is unreachable and performs no delete query', () => {
  const source = readSource('src/api/supabase/adapter.js');
  assert.match(source, /async delete\(\) \{\s*throw new Error\('Job hard deletion is unsupported'\)/);
  assert.equal(/from\('jobs'\)\.delete/.test(source), false);
});

test('job-first records verify detail before rendering and reject stale responses', () => {
  const source = readSource('src/pages/JobModuleRecords.jsx');
  assert.match(source, /onsiteApi\.jobs\.get\(jobScope\.companyId, normalizedJobId\)/);
  assert.match(source, /setJob\(null\)/);
  assert.match(source, /requestId !== requestIdRef\.current/);
  assert.match(source, /verifiedRequestKey === requestKey/);
  assert.match(source, /hasCurrentVerification \? job : null/);
  assert.match(source, /The requested job is unavailable in the active workspace/);
  assert.match(source, /no module records have been requested, cached or fabricated/);
  assert.equal(source.includes('jobId.toLowerCase()'), false);
});

test('all five approved job-first routes and status identifiers remain unchanged', () => {
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
  assert.deepEqual(
    ['active', 'completed', 'on_hold'].map(formatJobStatusLabel),
    ['ACTIVE', 'COMPLETED', 'On hold']
  );
});
