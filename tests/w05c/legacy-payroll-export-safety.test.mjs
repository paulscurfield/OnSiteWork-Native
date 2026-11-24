import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const readSource = relativePath => fs.readFileSync(
  new URL(`../../${relativePath}`, import.meta.url),
  'utf8',
);

const adminSource = readSource('src/pages/Admin.jsx');
const appSource = readSource('src/App.jsx');
const timesheetsSource = readSource('src/pages/Timesheets.jsx');
const timesheetsAdapterSource = readSource('src/api/supabase/timesheets-admin-adapter.js');

const sourceSection = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return source.slice(start, end);
};

test('legacy payroll download and email execution boundaries are absent', () => {
  for (const forbidden of [
    'exportCSV',
    'buildMyobCsv',
    'doMYOBDownload',
    'exportMYOB',
    'exportWorkerMYOB',
    'handleMyobPickerExport',
    'handleEmailExport',
    'showMyobPickerModal',
    'showEmailModal',
    'MYOB-ready',
    'direct import into MYOB',
  ]) {
    assert.equal(adminSource.includes(forbidden), false, forbidden);
  }

  assert.equal(
    fs.existsSync(new URL('../../src/components/timesheets/PayrollExportDialog.jsx', import.meta.url)),
    false,
  );
});

test('direct /admin access reaches a protected page with no Timesheets export boundary', () => {
  assert.match(appSource, /<Route element={<PrivateRouteGate\s*\/>}>/);
  assert.match(appSource, /<Route path="\/admin" element={<Admin\s*\/>}\s*\/>/);
  assert.match(adminSource, /const isAdminRole = \(role\) => role === 'owner' \|\| role === 'admin'/);
  assert.match(adminSource, /if \(!user \|\| !isAdmin\)/);
  assert.match(adminSource, /You need admin privileges to view this page/);

  const timesheetsTab = sourceSection(
    adminSource,
    '{/* Timesheets Tab */}',
    '{/* Add Day Modal */}',
  );
  assert.match(timesheetsTab, /Legacy payroll exports are disabled/);
  assert.match(timesheetsTab, /approved immutable export snapshot/);
  assert.doesNotMatch(
    timesheetsTab,
    /new Blob|createObjectURL|\.download\s*=|SendEmail|MYOB|create_payroll_export|get_payroll_export|list_payroll_export/u,
  );
});

test('the only remaining legacy Admin CSV and email actions are Pre-Start specific', () => {
  assert.equal((adminSource.match(/new Blob/g) || []).length, 1);
  assert.equal((adminSource.match(/\.download\s*=/g) || []).length, 1);
  assert.equal((adminSource.match(/integrations\.Core\.SendEmail/g) || []).length, 1);
  assert.match(adminSource, /a\.download = `pre-starts/);
  assert.match(adminSource, /const exportPreStartsCSV = \(\) =>/);
  assert.match(adminSource, /const handlePreStartEmailExport = async \(\) =>/);
});

test('unrelated Admin jobs, timesheet maintenance, workers and Pre-Starts remain available', () => {
  assert.match(adminSource, /const tabs = \['Jobs', 'Timesheets', 'Workers', 'Pre-Starts'\]/);
  for (const retainedHandler of [
    'handleSaveJob',
    'handleSaveAddDay',
    'handleSaveEntry',
    'handleDeleteEntry',
    'handleSendInvitation',
    'exportPreStartsCSV',
    'handlePreStartEmailExport',
  ]) {
    assert.match(adminSource, new RegExp(`const ${retainedHandler} =`), retainedHandler);
  }
});

test('W05-B Timesheet administration remains scoped and introduces no export RPC', () => {
  assert.match(timesheetsSource, /view === 'company' \? 'Owner\/Admin review' : 'Read only'/);
  assert.match(timesheetsSource, /view !== 'company'/);
  assert.match(timesheetsSource, /onsiteApi\.timesheetsAdmin\.correct/);
  assert.match(timesheetsSource, /onsiteApi\.timesheetsAdmin\.finalise/);
  assert.match(timesheetsSource, /onsiteApi\.timesheetsAdmin\.reopen/);

  const inspectedSources = [adminSource, appSource, timesheetsSource, timesheetsAdapterSource].join('\n');
  assert.doesNotMatch(
    inspectedSources,
    /create_payroll_export_admin|get_payroll_export_admin|list_payroll_exports_admin/u,
  );
});
