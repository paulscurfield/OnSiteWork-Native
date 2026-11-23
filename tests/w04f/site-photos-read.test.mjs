import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createSitePhotosReadAdapter,
  mapSitePhoto,
} from '../../src/api/supabase/site-photos-read-adapter.js';
import {
  createSitePhotoDetailKey,
  createSitePhotoScopeKey,
  resolveSitePhotoReadScope,
} from '../../src/lib/site-photo-access.js';
import { JOB_FIRST_MODULES, getJobRecordsPath } from '../../src/navigation/dashboard-modules.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const WORKER_ID = '22222222-2222-4222-8222-222222222222';
const COMPANY_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_COMPANY_ID = '44444444-4444-4444-8444-444444444444';
const JOB_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_JOB_ID = '66666666-6666-4666-8666-666666666666';
const PHOTO_ID = '77777777-7777-4777-8777-777777777777';
const OTHER_PHOTO_ID = '88888888-8888-4888-8888-888888888888';

const scope = (overrides = {}) => ({
  userId: USER_ID,
  companyId: COMPANY_ID,
  companyName: 'Alpha',
  role: 'admin',
  jobId: JOB_ID,
  jobName: 'Hospital',
  jobNumber: 'J-100',
  ...overrides,
});

const jobScope = (overrides = {}) => ({
  userId: USER_ID,
  companyId: COMPANY_ID,
  companyName: 'Alpha',
  role: 'admin',
  ...overrides,
});

const job = (overrides = {}) => ({
  id: JOB_ID,
  company_id: COMPANY_ID,
  job_name: 'Hospital',
  job_number: 'J-100',
  ...overrides,
});

const photoRow = (overrides = {}) => ({
  id: PHOTO_ID,
  company_id: COMPANY_ID,
  job_id: JOB_ID,
  worker_id: WORKER_ID,
  worker_name: 'Worker One',
  job_name: 'Hospital',
  job_number: 'J-100',
  photo_path: `company/${COMPANY_ID}/jobs/${JOB_ID}/workers/${WORKER_ID}/${PHOTO_ID}.jpg`,
  date: '2026-11-23',
  notes: 'Eastern elevation',
  media_type: 'image/jpeg',
  file_size_bytes: 2048,
  image_width: 1600,
  image_height: 1200,
  captured_at: '2026-11-23T00:58:00Z',
  uploaded_at: '2026-11-23T01:00:00Z',
  created_at: '2026-11-23T01:00:01Z',
  ...overrides,
});

const readSource = relativePath => fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

const createHarness = responses => {
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

test('Site Photo scope requires authenticated identity, company, approved role and a verified same-company Job', () => {
  assert.equal(resolveSitePhotoReadScope({ jobScope: null, job: job() }), null);
  assert.equal(resolveSitePhotoReadScope({ jobScope: jobScope({ userId: null }), job: job() }), null);
  assert.equal(resolveSitePhotoReadScope({ jobScope: jobScope({ role: 'supervisor' }), job: job() }), null);
  assert.equal(resolveSitePhotoReadScope({ jobScope: jobScope(), job: job({ company_id: OTHER_COMPANY_ID }) }), null);
  assert.equal(resolveSitePhotoReadScope({ jobScope: jobScope(), job: job({ id: 'invalid' }) }), null);
  assert.equal(resolveSitePhotoReadScope({ jobScope: jobScope(), job: job() }).jobId, JOB_ID);
});

test('Owner, Admin and Worker scopes are accepted while unsupported roles fail closed', () => {
  for (const role of ['owner', 'admin', 'worker']) {
    assert.equal(resolveSitePhotoReadScope({ jobScope: jobScope({ role }), job: job() }).role, role);
  }
  assert.equal(resolveSitePhotoReadScope({ jobScope: jobScope({ role: 'manager' }), job: job() }), null);
});

test('scope and detail keys change across identity, company, role, Job and photo', () => {
  const base = scope();
  assert.notEqual(createSitePhotoScopeKey(base), createSitePhotoScopeKey({ ...base, userId: WORKER_ID }));
  assert.notEqual(createSitePhotoScopeKey(base), createSitePhotoScopeKey({ ...base, companyId: OTHER_COMPANY_ID }));
  assert.notEqual(createSitePhotoScopeKey(base), createSitePhotoScopeKey({ ...base, role: 'owner' }));
  assert.notEqual(createSitePhotoScopeKey(base), createSitePhotoScopeKey({ ...base, jobId: OTHER_JOB_ID }));
  assert.notEqual(createSitePhotoDetailKey(base, PHOTO_ID), createSitePhotoDetailKey(base, OTHER_PHOTO_ID));
  assert.equal(createSitePhotoDetailKey(base, 'invalid'), null);
});

test('list calls only the approved job RPC with explicit company and Job scope', async () => {
  const harness = createHarness([{ data: { page_size: 20, photos: [photoRow()] }, error: null }]);
  const adapter = createSitePhotosReadAdapter(harness.rpc, async () => { throw new Error('unused'); });
  const result = await adapter.list(scope());
  assert.equal(result.items.length, 1);
  assert.equal(result.has_more, false);
  assert.deepEqual(harness.calls, [[
    'list_job_photos',
    {
      p_company_id: COMPANY_ID,
      p_job_id: JOB_ID,
      p_before_created_at: null,
      p_before_id: null,
      p_worker_id: null,
      p_date_from: null,
      p_date_to: null,
    },
  ]]);
});

test('list preserves approved metadata and supported nullable fields', async () => {
  const harness = createHarness([{ data: { page_size: 20, photos: [photoRow({ notes: null, captured_at: null, image_width: null, image_height: null })] }, error: null }]);
  const result = await createSitePhotosReadAdapter(harness.rpc, async () => {}).list(scope());
  assert.equal(result.items[0].notes, null);
  assert.equal(result.items[0].captured_at, null);
  assert.equal(result.items[0].image_width, null);
  assert.equal(result.items[0].worker_name, 'Worker One');
  assert.equal(result.items[0].job_id, JOB_ID);
});

test('list passes only approved worker, date and cursor filters', async () => {
  const harness = createHarness([{ data: { page_size: 20, photos: [] }, error: null }]);
  await createSitePhotosReadAdapter(harness.rpc, async () => {}).list(scope(), {
    cursor: { createdAt: '2026-11-22T01:00:00Z', id: PHOTO_ID },
    workerId: WORKER_ID,
    dateFrom: '2026-11-01',
    dateTo: '2026-11-23',
  });
  assert.deepEqual(harness.calls[0][1], {
    p_company_id: COMPANY_ID,
    p_job_id: JOB_ID,
    p_before_created_at: '2026-11-22T01:00:00Z',
    p_before_id: PHOTO_ID,
    p_worker_id: WORKER_ID,
    p_date_from: '2026-11-01',
    p_date_to: '2026-11-23',
  });
});

test('complete 20-item pages expose the native cursor boundary without inventing totals', async () => {
  const rows = Array.from({ length: 20 }, (_, index) => {
    const id = `${String(20 - index).padStart(8, '0')}-7777-4777-8777-777777777777`;
    return photoRow({ id, photo_path: `company/${COMPANY_ID}/jobs/${JOB_ID}/workers/${WORKER_ID}/${id}.jpg` });
  });
  const harness = createHarness([{ data: { page_size: 20, photos: rows }, error: null }]);
  const result = await createSitePhotosReadAdapter(harness.rpc, async () => {}).list(scope());
  assert.equal(result.has_more, true);
  assert.deepEqual(result.next_cursor, { createdAt: rows.at(-1).created_at, id: rows.at(-1).id });
  assert.equal('total_count' in result, false);
});

test('list rejects reversed dates before any RPC call', async () => {
  const harness = createHarness([]);
  await assert.rejects(
    () => createSitePhotosReadAdapter(harness.rpc, async () => {}).list(scope(), { dateFrom: '2026-11-23', dateTo: '2026-11-01' }),
    /cannot be before/,
  );
  assert.equal(harness.calls.length, 0);
});

test('list rejects cross-company and cross-Job rows', async () => {
  for (const row of [photoRow({ company_id: OTHER_COMPANY_ID }), photoRow({ job_id: OTHER_JOB_ID })]) {
    const harness = createHarness([{ data: { page_size: 20, photos: [row] }, error: null }]);
    await assert.rejects(() => createSitePhotosReadAdapter(harness.rpc, async () => {}).list(scope()), /crossed/);
  }
});

test('list rejects canonical paths that cross company, Job or uploader scope', () => {
  const invalidPaths = [
    `company/${OTHER_COMPANY_ID}/jobs/${JOB_ID}/workers/${WORKER_ID}/${PHOTO_ID}.jpg`,
    `company/${COMPANY_ID}/jobs/${OTHER_JOB_ID}/workers/${WORKER_ID}/${PHOTO_ID}.jpg`,
    `company/${COMPANY_ID}/jobs/${JOB_ID}/workers/${USER_ID}/${PHOTO_ID}.jpg`,
  ];
  for (const photoPath of invalidPaths) assert.throws(() => mapSitePhoto(photoRow({ photo_path: photoPath }), scope()), /object path/);
});

test('list rejects unsupported media, inconsistent extension, size and dimensions', () => {
  const invalid = [
    photoRow({ media_type: 'image/gif' }),
    photoRow({ media_type: 'image/png' }),
    photoRow({ file_size_bytes: 0 }),
    photoRow({ image_width: 1600, image_height: null }),
    photoRow({ image_width: 100001, image_height: 1200 }),
  ];
  for (const row of invalid) assert.throws(() => mapSitePhoto(row, scope()));
});

test('list rejects malformed dates, timestamps, envelopes and ordering', async () => {
  const payloads = [
    { page_size: 19, photos: [] },
    { page_size: 20, photos: [photoRow({ date: '2026-02-30' })] },
    { page_size: 20, photos: [photoRow({ uploaded_at: 'not-a-time' })] },
    { page_size: 20, photos: [photoRow({ id: OTHER_PHOTO_ID, photo_path: `company/${COMPANY_ID}/jobs/${JOB_ID}/workers/${WORKER_ID}/${OTHER_PHOTO_ID}.jpg`, created_at: '2026-11-22T01:00:00Z' }), photoRow()] },
  ];
  for (const data of payloads) {
    const harness = createHarness([{ data, error: null }]);
    await assert.rejects(() => createSitePhotosReadAdapter(harness.rpc, async () => {}).list(scope()));
  }
});

test('permission and backend errors propagate without privileged fallback', async () => {
  for (const error of [Object.assign(new Error('denied'), { code: '42501' }), new Error('offline')]) {
    const harness = createHarness([{ data: null, error }]);
    await assert.rejects(() => createSitePhotosReadAdapter(harness.rpc, async () => {}).list(scope()), candidate => candidate === error);
    assert.equal(harness.calls.length, 1);
  }
});

test('detail calls get_job_photo with exact identifiers and validates the returned identity', async () => {
  const harness = createHarness([{ data: { job_photo: photoRow() }, error: null }]);
  const result = await createSitePhotosReadAdapter(harness.rpc, async () => {}).get(scope(), PHOTO_ID);
  assert.equal(result.id, PHOTO_ID);
  assert.deepEqual(harness.calls, [['get_job_photo', { p_company_id: COMPANY_ID, p_job_photo_id: PHOTO_ID }]]);
  assert.throws(() => mapSitePhoto(photoRow(), scope(), OTHER_PHOTO_ID), /crossed/);
});

test('private image retrieval uses the canonical bucket, path and 60-second expiry', async () => {
  const calls = [];
  const signed = async (...args) => {
    calls.push(args);
    return { data: { signedUrl: 'https://eyejarxvlmjxeedcserm.supabase.co/storage/v1/object/sign/job-photos/example?token=redacted' }, error: null };
  };
  const result = await createSitePhotosReadAdapter(async () => {}, signed).createImageUrl(scope(), photoRow());
  assert.match(result, /^https:\/\//);
  assert.deepEqual(calls, [['job-photos', photoRow().photo_path, 60]]);
});

test('image retrieval rejects cross-scope metadata, public URLs and Storage errors', async () => {
  const adapter = createSitePhotosReadAdapter(async () => {}, async () => ({ data: { signedUrl: 'http://example.test/public.jpg' }, error: null }));
  await assert.rejects(() => adapter.createImageUrl(scope(), photoRow({ company_id: OTHER_COMPANY_ID })), /crossed/);
  await assert.rejects(() => adapter.createImageUrl(scope(), photoRow()), /signed image URL/);
  const denied = Object.assign(new Error('denied'), { code: '42501' });
  const deniedAdapter = createSitePhotosReadAdapter(async () => {}, async () => ({ data: null, error: denied }));
  await assert.rejects(() => deniedAdapter.createImageUrl(scope(), photoRow()), candidate => candidate === denied);
});

test('read adapter exposes no direct table, public URL, thumbnail or mutation path', () => {
  const source = readSource('src/api/supabase/site-photos-read-adapter.js');
  assert.match(source, /list_job_photos/);
  assert.match(source, /get_job_photo/);
  assert.match(source, /createSignedUrl/);
  for (const token of ["from('job_photos')", 'getPublicUrl', 'job-photo-thumbnails', '.insert(', '.update(', '.delete(', '.upload(', '.remove(', 'service_role']) {
    assert.equal(source.includes(token), false, token);
  }
});

test('component pins list, detail and image results to independent request identities', () => {
  const source = readSource('src/components/site-photos/SitePhotoRecords.jsx');
  assert.match(source, /listRequestIdRef/);
  assert.match(source, /detailRequestIdRef/);
  assert.match(source, /imageRequestIdRef/);
  assert.match(source, /listResultKey === currentListKey/);
  assert.match(source, /detailResultKey === detailRequestKey/);
  assert.match(source, /imageResultKey === currentImageKey/);
  assert.match(source, /setPhotos\(\[\]\)/);
  assert.match(source, /setImageUrl\(''\)/);
});

test('component provides loading, empty, unavailable, denied, backend-error and preview-unavailable states', () => {
  const source = readSource('src/components/site-photos/SitePhotoRecords.jsx');
  for (const phrase of ['Loading Site Photos', 'No Site Photos', 'Site Photos unavailable', 'Site Photo access restricted', 'Site Photo details unavailable', 'Image preview unavailable']) {
    assert.match(source, new RegExp(phrase));
  }
});

test('component supports newest-first pagination and approved date filtering', () => {
  const source = readSource('src/components/site-photos/SitePhotoRecords.jsx');
  assert.match(source, /next_cursor/);
  assert.match(source, /Load more Site Photos/);
  assert.match(source, /existingIds\.has\(photo\.id\)/);
  assert.match(source, /dateFrom/);
  assert.match(source, /dateTo/);
  assert.doesNotMatch(source, /categoryFilter|sourceFilter/);
});

test('component renders authorised metadata and an honest delivery-association deferral', () => {
  const source = readSource('src/components/site-photos/SitePhotoRecords.jsx');
  assert.match(source, /worker_name/);
  assert.match(source, /media_type/);
  assert.match(source, /file_size_bytes/);
  assert.match(source, /Delivery association/);
  assert.match(source, /Not exposed by the approved Site Photos read contract/);
  assert.doesNotMatch(source, /list_site_diary_deliveries|site_diary_delivery_photos/);
});

test('component has no reachable upload, edit, delete, download, export or bulk controls', () => {
  const source = readSource('src/components/site-photos/SitePhotoRecords.jsx');
  for (const token of ['type="file"', '.upload(', '.delete(', '.remove(', 'Download photo', 'Export photos', 'Create ZIP', 'bulk selection', 'createObjectURL']) {
    assert.equal(source.includes(token), false, token);
  }
});

test('legacy direct Site Photos route redirects to the verified job-first selector', () => {
  const source = readSource('src/pages/SitePhotos.jsx');
  assert.match(source, /Navigate/);
  assert.match(source, /\/work\/site-photos\/jobs/);
  assert.doesNotMatch(source, /type="file"|createWorker|upload|delete|download/iu);
});

test('legacy Admin Site Photos read and delete controls are unreachable from the Admin tabs', () => {
  const source = readSource('src/pages/Admin.jsx');
  assert.match(source, /const tabs = \['Jobs', 'Timesheets', 'Workers', 'Pre-Starts'\]/);
  assert.doesNotMatch(source, /const tabs = \[[^\]]*'Photos'/);
});

test('JobModuleRecords replaces only the Site Photos shell with the focused read component', () => {
  const source = readSource('src/pages/JobModuleRecords.jsx');
  assert.match(source, /SitePhotoRecords/);
  assert.match(source, /module\.key === 'site-photos'/);
  assert.match(source, /PurchaseOrderRecords/);
  assert.match(source, /ToolboxTalkRecords/);
  assert.match(source, /SiteDiaryRecords/);
  assert.match(source, /PreStartJobRecords/);
});

test('adapter wiring uses only RPC and private signed-URL dependencies', () => {
  const source = readSource('src/api/supabase/adapter.js');
  assert.match(source, /sitePhotosRead: createSitePhotosReadAdapter/);
  assert.match(source, /supabase\.storage\.from\(bucket\)\.createSignedUrl/);
  assert.doesNotMatch(source.match(/sitePhotosRead:[\s\S]*?\n\s*\),/)?.[0] || '', /insert|update|delete|upload|remove/);
});

test('Site Photos remains separate from Pre-Start fault photos and abandoned thumbnails', () => {
  const combined = [
    readSource('src/api/supabase/site-photos-read-adapter.js'),
    readSource('src/components/site-photos/SitePhotoRecords.jsx'),
    readSource('src/lib/site-photo-access.js'),
  ].join('\n');
  assert.equal(combined.includes('pre_start'), false);
  assert.equal(combined.includes('fault_photo'), false);
  assert.equal(combined.includes('job-photo-thumbnails'), false);
  assert.equal(combined.includes('generate-site-photo-thumbnail'), false);
});

test('all five job-first routes remain on their original identifiers', () => {
  assert.deepEqual(Object.keys(JOB_FIRST_MODULES), ['pre-starts', 'toolbox-talks', 'site-diaries', 'site-photos', 'purchase-orders']);
  for (const key of Object.keys(JOB_FIRST_MODULES)) assert.equal(getJobRecordsPath(key, JOB_ID), `/work/${key}/jobs/${JOB_ID}`);
});

test('previous W04 module components remain present and are not imported into Site Photos', () => {
  const source = readSource('src/components/site-photos/SitePhotoRecords.jsx');
  for (const path of [
    'src/components/purchase-orders/PurchaseOrderRecords.jsx',
    'src/components/toolbox-talks/ToolboxTalkRecords.jsx',
    'src/components/site-diaries/SiteDiaryRecords.jsx',
    'src/components/pre-starts/PreStartJobRecords.jsx',
  ]) assert.ok(readSource(path).length > 100);
  assert.doesNotMatch(source, /PurchaseOrderRecords|ToolboxTalkRecords|SiteDiaryRecords|PreStartJobRecords/);
});
