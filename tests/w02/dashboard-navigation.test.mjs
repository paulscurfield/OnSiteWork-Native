import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createWorkspaceJobContextKey,
  DASHBOARD_MODULES,
  getJobFirstModule,
  getJobRecordsPath,
  getJobSelectorPath,
  isValidJobIdentifier,
  JOB_FIRST_MODULES,
} from '../../src/navigation/dashboard-modules.js';
import { formatJobStatusLabel } from '../../src/pages/job-status.js';

const readSource = relativePath => fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
const VALID_COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const VALID_JOB_ID = '22222222-2222-4222-8222-222222222222';

test('dashboard exposes exactly the 12 approved modules in the approved order', () => {
  assert.deepEqual(
    DASHBOARD_MODULES.map(module => module.label),
    [
      'Timesheets',
      'Jobs',
      'Equipment',
      'Pre-Starts',
      'Toolbox Talks',
      'Site Diaries',
      'Site Photos',
      'Purchase Orders',
      'Leave',
      'Team',
      'Calendar',
      'Profile',
    ]
  );
  assert.equal(DASHBOARD_MODULES.length, 12);
});

test('dashboard configuration excludes generic Admin, Messenger and Team Map tiles', () => {
  const labels = DASHBOARD_MODULES.map(module => module.label.toLowerCase());
  const paths = DASHBOARD_MODULES.map(module => module.path);
  assert.equal(labels.includes('admin'), false);
  assert.equal(labels.includes('messages'), false);
  assert.equal(labels.includes('messenger'), false);
  assert.equal(labels.includes('team map'), false);
  assert.equal(paths.includes('/admin'), false);
  assert.equal(paths.includes('/messages'), false);
  assert.equal(paths.includes('/team-map'), false);
});

test('all five approved record modules use one explicit job-first route pattern', () => {
  assert.deepEqual(Object.keys(JOB_FIRST_MODULES), [
    'pre-starts',
    'toolbox-talks',
    'site-diaries',
    'site-photos',
    'purchase-orders',
  ]);

  for (const module of Object.values(JOB_FIRST_MODULES)) {
    assert.equal(module.path, `/work/${module.key}/jobs`);
    assert.equal(getJobSelectorPath(module.key), module.path);
    assert.equal(getJobRecordsPath(module.key, VALID_JOB_ID), `${module.path}/${VALID_JOB_ID}`);
    assert.equal(getJobFirstModule(module.key), module);
  }
});

test('job identifiers fail closed for missing, malformed and injected values', () => {
  for (const jobId of ['', 'not-a-job', '../admin', `${VALID_JOB_ID}/extra`, '123']) {
    assert.equal(isValidJobIdentifier(jobId), false);
    assert.throws(() => getJobRecordsPath('pre-starts', jobId), /valid job identifier/);
  }
  assert.equal(isValidJobIdentifier(VALID_JOB_ID), true);
  assert.throws(() => getJobSelectorPath('unknown-module'), /Unknown job-first module/);
});

test('workspace cache identity requires company, module and job together', () => {
  assert.equal(
    createWorkspaceJobContextKey(VALID_COMPANY_ID, 'site-diaries', VALID_JOB_ID),
    `${VALID_COMPANY_ID}:site-diaries:${VALID_JOB_ID}`
  );
  assert.equal(createWorkspaceJobContextKey('', 'site-diaries', VALID_JOB_ID), null);
  assert.equal(createWorkspaceJobContextKey(VALID_COMPANY_ID, 'unknown-module', VALID_JOB_ID), null);
  assert.equal(createWorkspaceJobContextKey(VALID_COMPANY_ID, 'site-diaries', 'invalid'), null);
});

test('application routes support selectors, selected-job deep links, refresh and Team', () => {
  const source = readSource('src/App.jsx');
  assert.match(source, /path="\/work\/:moduleKey\/jobs"/);
  assert.match(source, /path="\/work\/:moduleKey\/jobs\/:jobId"/);
  assert.match(source, /path="\/team"/);
  for (const module of DASHBOARD_MODULES.filter(item => !item.jobFirst)) {
    assert.equal(source.includes(`path="${module.path}"`), true, `${module.label} route is missing`);
  }
  assert.match(source, /<Route path="\/site-photos" element={<SitePhotos \/>} \/>/);
  assert.match(source, /<Route path="\/prestart" element={<PreStart \/>} \/>/);
});

test('shared Jobs page performs company-scoped loading and renders module selection links', () => {
  const source = readSource('src/pages/Jobs.jsx');
  assert.match(source, /resolveJobReadScope/);
  assert.match(source, /onsiteApi\.jobs\.list\(jobScope\.companyId\)/);
  assert.equal(source.includes('tables.companies.list'), false);
  assert.match(source, /getJobFirstModule\(moduleKey\)/);
  assert.match(source, /getJobRecordsPath\(jobModule\.key, job\.id\)/);
  assert.match(source, /setJobs\(\[\]\)/);
  assert.match(source, /No cached job list is displayed/);
});

test('job status labels format on_hold without changing status identifiers or navigation', () => {
  const jobs = Object.freeze([
    Object.freeze({ id: VALID_JOB_ID, status: 'active' }),
    Object.freeze({ id: VALID_JOB_ID, status: 'completed' }),
    Object.freeze({ id: VALID_JOB_ID, status: 'on_hold' }),
  ]);

  assert.deepEqual(jobs.map(job => formatJobStatusLabel(job.status)), [
    'ACTIVE',
    'COMPLETED',
    'On hold',
  ]);
  assert.deepEqual(jobs.map(job => job.status), ['active', 'completed', 'on_hold']);
  assert.equal(
    getJobRecordsPath('pre-starts', jobs[2].id),
    `/work/pre-starts/jobs/${VALID_JOB_ID}`
  );

  const jobsSource = readSource('src/pages/Jobs.jsx');
  const adapterSource = readSource('src/api/supabase/adapter.js');
  assert.match(jobsSource, /formatJobStatusLabel\(job\.status\)/);
  assert.match(jobsSource, /statusColors\[job\.status\]/);
  assert.match(jobsSource, /<option value="on_hold">On Hold<\/option>/);
  assert.match(adapterSource, /JOB_STATUS_VALUES = new Set\(\['active', 'completed', 'on_hold'\]\)/);
});

test('record shells disclose incomplete integration and do not persist cached records', () => {
  const source = readSource('src/pages/JobModuleRecords.jsx');
  assert.match(source, /onsiteApi\.jobs\.get\(jobScope\.companyId, normalizedJobId\)/);
  assert.match(source, /Module integration pending/);
  assert.match(source, /no module records have been requested, cached or fabricated/);
  assert.match(source, /The backend remains the authorization boundary/);
  assert.equal(source.includes('localStorage'), false);
  assert.equal(source.includes('sessionStorage'), false);
});

test('dashboard keeps clock status mobile-only and provides responsive, keyboard-focusable tiles', () => {
  const dashboard = readSource('src/pages/Dashboard.jsx');
  const layout = readSource('src/components/Layout.jsx');
  assert.match(dashboard, /aria-label="Clock status"/);
  assert.match(dashboard, /md:hidden/);
  assert.match(dashboard, /md:grid-cols-3/);
  assert.match(dashboard, /xl:grid-cols-4/);
  assert.match(dashboard, /focus-visible:ring-2/);
  assert.equal(dashboard.includes("to=\"/admin\""), false);
  assert.equal(dashboard.includes("to=\"/messages\""), false);
  assert.equal(dashboard.includes("to=\"/team-map\""), false);
  assert.match(layout, /lg:flex/);
  assert.match(layout, /lg:hidden/);
  assert.match(layout, /aria-label="Administration modules"/);
});

test('Team directory remains read-only and uses the active company RPC adapter', () => {
  const source = readSource('src/pages/Team.jsx');
  assert.match(source, /onsiteApi\.teamDirectory\.list\(teamScope\.companyId\)/);
  assert.match(source, /resolveTeamReadScope/);
  assert.match(source, /Company team directory/);
  assert.equal(source.includes('canAdministerTeam'), false);
  assert.equal(source.includes('Invite'), false);
  assert.equal(source.includes('Delete'), false);
  assert.equal(source.includes('supervisor'), false);
});
