import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createProfileReadAdapter,
  mapSelfProfile,
  SELF_PROFILE_FIELDS,
} from '../../src/api/supabase/profile-read-adapter.js';
import {
  createProfileIdentityKey,
  profileRoleLabel,
  resolveProfileWorkspace,
} from '../../src/lib/profile-access.js';
import { DASHBOARD_MODULES, getJobRecordsPath, JOB_FIRST_MODULES } from '../../src/navigation/dashboard-modules.js';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';

const authUser = (overrides = {}) => ({
  id: USER_ID,
  email: 'worker@example.invalid',
  phone: '+61400123456',
  email_confirmed_at: '2026-11-01T00:00:00.000Z',
  phone_confirmed_at: null,
  user_metadata: { private_value: 'must not be mapped' },
  ...overrides,
});

const profileRow = (overrides = {}) => ({
  id: USER_ID,
  email: ' worker@example.invalid ',
  full_name: ' Worker One ',
  phone: ' +61 400 123 456 ',
  avatar_path: null,
  worker_id: 'private-worker-reference',
  ...overrides,
});

const createQueryHarness = (response) => {
  const calls = [];
  const from = table => {
    calls.push(['from', table]);
    const query = {
      select: (...args) => { calls.push(['select', ...args]); return query; },
      eq: (...args) => { calls.push(['eq', ...args]); return query; },
      maybeSingle: () => { calls.push(['maybeSingle']); return query; },
      then: (resolve, reject) => Promise.resolve(response).then(resolve, reject),
    };
    return query;
  };
  return { calls, from };
};

const readSource = relativePath => fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('self-profile adapter validates Auth identity and performs one exact self-only query', async () => {
  const harness = createQueryHarness({ data: profileRow(), error: null });
  const getUserCalls = [];
  const adapter = createProfileReadAdapter(async () => {
    getUserCalls.push('getUser');
    return { data: { user: authUser() }, error: null };
  }, harness.from);

  const profile = await adapter.get(USER_ID.toUpperCase());
  assert.equal(profile.id, USER_ID);
  assert.equal(profile.full_name, 'Worker One');
  assert.equal(profile.email, 'worker@example.invalid');
  assert.equal(profile.phone, '+61 400 123 456');
  assert.deepEqual(getUserCalls, ['getUser']);
  assert.deepEqual(harness.calls, [
    ['from', 'profiles'],
    ['select', SELF_PROFILE_FIELDS],
    ['eq', 'id', USER_ID],
    ['maybeSingle'],
  ]);
});

test('no authenticated session fails before any profile table query', async () => {
  const harness = createQueryHarness({ data: profileRow(), error: null });
  const adapter = createProfileReadAdapter(async () => ({ data: { user: null }, error: null }), harness.from);
  await assert.rejects(() => adapter.get(USER_ID), error => error.code === '28000');
  assert.deepEqual(harness.calls, []);
});

test('missing self-profile is represented as null', async () => {
  const harness = createQueryHarness({ data: null, error: null });
  const adapter = createProfileReadAdapter(async () => ({ data: { user: authUser() }, error: null }), harness.from);
  assert.equal(await adapter.get(USER_ID), null);
});

test('profile adapter rejects invalid identifiers and an authentication identity change', async () => {
  const harness = createQueryHarness({ data: profileRow(), error: null });
  const changed = createProfileReadAdapter(async () => ({ data: { user: authUser({ id: OTHER_USER_ID }) }, error: null }), harness.from);
  await assert.rejects(() => changed.get(USER_ID), /Authenticated user changed/);
  await assert.rejects(() => changed.get('not-a-uuid'), /Expected user ID/);
  assert.deepEqual(harness.calls, []);
});

test('cross-user and malformed profile responses fail closed', () => {
  assert.throws(() => mapSelfProfile(profileRow({ id: OTHER_USER_ID }), authUser()), /another user/);
  assert.throws(() => mapSelfProfile(profileRow({ full_name: 42 }), authUser()), /invalid full name/);
  assert.throws(() => mapSelfProfile(profileRow(), authUser({ email_confirmed_at: 'not-a-date' })), /email confirmation/);
  assert.throws(() => mapSelfProfile(null, authUser()), /invalid profile/);
});

test('Auth and query permission/general errors propagate unchanged', async () => {
  const authError = Object.assign(new Error('Auth denied'), { code: '28000' });
  const authAdapter = createProfileReadAdapter(async () => ({ data: null, error: authError }), () => { throw new Error('unexpected query'); });
  await assert.rejects(() => authAdapter.get(USER_ID), candidate => candidate === authError);

  for (const queryError of [Object.assign(new Error('RLS denied'), { code: '42501' }), new Error('offline')]) {
    const harness = createQueryHarness({ data: null, error: queryError });
    const adapter = createProfileReadAdapter(async () => ({ data: { user: authUser() }, error: null }), harness.from);
    await assert.rejects(() => adapter.get(USER_ID), candidate => candidate === queryError);
  }
});

test('only confirmed profile fields are mapped and private Auth metadata is omitted', () => {
  const profile = mapSelfProfile(profileRow({
    access_token: 'must not appear',
    refresh_token: 'must not appear',
  }), authUser());
  assert.deepEqual(Object.keys(profile), [
    'id',
    'full_name',
    'email',
    'phone',
    'avatar_path',
    'email_verification',
    'phone_verification',
  ]);
  assert.equal(profile.email_verification, 'verified');
  assert.equal(profile.phone_verification, 'unverified');
});

test('verification labels require matching Auth contact evidence', () => {
  const mismatch = mapSelfProfile(profileRow({ email: 'profile@example.invalid', phone: '0400000000' }), authUser());
  assert.equal(mismatch.email_verification, 'unknown');
  assert.equal(mismatch.phone_verification, 'unknown');

  const absent = mapSelfProfile(profileRow({ email: null, phone: null }), authUser({ email: null, phone: null }));
  assert.equal(absent.email_verification, 'unavailable');
  assert.equal(absent.phone_verification, 'unavailable');

  const confirmedPhone = mapSelfProfile(profileRow(), authUser({ phone_confirmed_at: '2026-11-02T00:00:00Z' }));
  assert.equal(confirmedPhone.phone_verification, 'verified');
});

test('profile contact fields fall back to Auth only when the profile value is missing', () => {
  const profile = mapSelfProfile(profileRow({ email: null, phone: null }), authUser());
  assert.equal(profile.email, 'worker@example.invalid');
  assert.equal(profile.phone, '+61400123456');
  assert.equal(profile.email_verification, 'verified');
});

test('active workspace role belongs to the matching user and selected company only', () => {
  const workspace = resolveProfileWorkspace({
    userId: USER_ID,
    company: { id: COMPANY_A, name: ' Alpha ' },
    membership: { company_id: COMPANY_A, user_id: USER_ID, role: 'admin' },
  });
  assert.deepEqual(workspace, { companyId: COMPANY_A, companyName: 'Alpha', role: 'admin' });
  assert.equal(resolveProfileWorkspace({
    userId: USER_ID,
    company: { id: COMPANY_A, name: 'Alpha' },
    membership: { company_id: COMPANY_B, user_id: USER_ID, role: 'owner' },
  }), null);
  assert.equal(resolveProfileWorkspace({
    userId: USER_ID,
    company: { id: COMPANY_A, name: 'Alpha' },
    membership: { company_id: COMPANY_A, user_id: OTHER_USER_ID, role: 'owner' },
  }), null);
});

test('multiple companies can present distinct current roles without changing profile identity', () => {
  const alpha = resolveProfileWorkspace({ userId: USER_ID, company: { id: COMPANY_A, name: 'Alpha' }, membership: { company_id: COMPANY_A, user_id: USER_ID, role: 'owner' } });
  const beta = resolveProfileWorkspace({ userId: USER_ID, company: { id: COMPANY_B, name: 'Beta' }, membership: { company_id: COMPANY_B, user_id: USER_ID, role: 'worker' } });
  assert.equal(alpha.role, 'owner');
  assert.equal(beta.role, 'worker');
  assert.equal(createProfileIdentityKey(USER_ID), USER_ID);
});

test('historical supervisor displays only as Worker', () => {
  const workspace = resolveProfileWorkspace({
    userId: USER_ID,
    company: { id: COMPANY_A, name: 'Alpha' },
    membership: { company_id: COMPANY_A, user_id: USER_ID, role: 'supervisor' },
  });
  assert.equal(workspace.role, 'worker');
  assert.equal(profileRoleLabel(workspace.role), 'Worker');
  assert.equal(profileRoleLabel('owner'), 'Owner');
  assert.equal(profileRoleLabel('admin'), 'Admin');
});

test('Profile page clears identity data and rejects late profile/avatar responses', () => {
  const page = readSource('src/pages/Profile.jsx');
  assert.match(page, /onsiteApi\.profileRead\.get\(identityKey\)/);
  assert.match(page, /profileResultKey === identityKey/);
  assert.match(page, /setProfile\(null\)/);
  assert.match(page, /requestId !== profileRequestIdRef\.current/);
  assert.match(page, /profileRequestIdRef\.current \+= 1/);
  assert.match(page, /avatarResultKey === expectedAvatarKey/);
  assert.match(page, /requestId !== avatarRequestIdRef\.current/);
  assert.match(page, /No previous account information is displayed/);
});

test('Profile page keeps identity separate from active workspace role during switching', () => {
  const page = readSource('src/pages/Profile.jsx');
  assert.match(page, /resolveProfileWorkspace/);
  assert.match(page, /loadingCompany/);
  assert.match(page, /Previous company-role information is hidden while the workspace changes/);
  assert.match(page, /Active company membership/);
  assert.match(page, /profileRoleLabel\(workspace\.role\)/);
  assert.equal(page.includes('companies.list'), false);
  assert.equal(page.includes('companyMembers.filter'), false);
});

test('Profile avatar is self-only and read-only with no upload fallback', () => {
  const page = readSource('src/pages/Profile.jsx');
  assert.match(page, /onsiteApi\.auth\.getMyAvatarSignedUrl\(visibleProfile\.avatar_path\)/);
  assert.equal(page.includes('replaceMyAvatar'), false);
  assert.equal(page.includes('type="file"'), false);
  assert.equal(page.includes('avatarInputRef'), false);
});

test('Profile integration has no reachable profile, account or authentication mutation controls', () => {
  const page = readSource('src/pages/Profile.jsx');
  const adapter = readSource('src/api/supabase/profile-read-adapter.js');
  const combined = `${page}\n${adapter}`;
  for (const token of ['.insert(', '.update(', '.delete(', '.upsert(', '.upload(', 'updateMyProfile', 'updateMe', 'replaceMyAvatar', 'set_my_avatar_path', 'logout(', 'Save Profile', 'Edit Profile', 'Change password', 'Delete account']) {
    assert.equal(combined.includes(token), false, token);
  }
});

test('Profile, dashboard and all completed W03 navigation remain intact', () => {
  assert.equal(DASHBOARD_MODULES.find(module => module.key === 'profile').path, '/profile');
  assert.deepEqual(Object.keys(JOB_FIRST_MODULES), ['pre-starts', 'toolbox-talks', 'site-diaries', 'site-photos', 'purchase-orders']);
  for (const moduleKey of Object.keys(JOB_FIRST_MODULES)) {
    assert.equal(getJobRecordsPath(moduleKey, JOB_ID), `/work/${moduleKey}/jobs/${JOB_ID}`);
  }
  const app = readSource('src/App.jsx');
  assert.match(app, /path="\/profile" element={<Profile \/>}/);
  assert.match(readSource('src/pages/Jobs.jsx'), /onsiteApi\.jobs\.list/);
  assert.match(readSource('src/pages/Team.jsx'), /onsiteApi\.teamDirectory\.list/);
  assert.match(readSource('src/pages/Equipment.jsx'), /onsiteApi\.equipmentRead\.list/);
});
