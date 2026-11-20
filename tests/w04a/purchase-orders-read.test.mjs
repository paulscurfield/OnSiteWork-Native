import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createPurchaseOrdersReadAdapter,
  mapPurchaseOrderDetails,
  mapPurchaseOrderItemRow,
  mapPurchaseOrderListRow,
  PURCHASE_ORDER_DETAIL_FIELDS,
  PURCHASE_ORDER_ITEM_FIELDS,
  PURCHASE_ORDER_LIST_FIELDS,
} from '../../src/api/supabase/purchase-orders-read-adapter.js';
import {
  createPurchaseOrderRequestKey,
  createPurchaseOrderScopeKey,
  isPurchaseOrderPermissionError,
  resolvePurchaseOrderReadScope,
} from '../../src/lib/purchase-order-access.js';
import { JOB_FIRST_MODULES } from '../../src/navigation/dashboard-modules.js';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_JOB_ID = '44444444-4444-4444-8444-444444444444';
const ORDER_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_ORDER_ID = '66666666-6666-4666-8666-666666666666';
const ITEM_ID = '77777777-7777-4777-8777-777777777777';

const listRow = (overrides = {}) => ({
  id: ORDER_ID,
  company_id: COMPANY_ID,
  job_id: JOB_ID,
  po_number: 'PO-000123',
  supplier_name: ' Test Supplier ',
  status: 'draft',
  total_inc_gst: '27.50',
  currency_code: 'AUD',
  created_at: '2026-11-19T01:00:00.000Z',
  ...overrides,
});

const detailRow = (overrides = {}) => ({
  ...listRow(),
  supplier_contact_name: ' Casey Contact ',
  supplier_email: ' accounts@example.test ',
  supplier_phone: ' 02 0000 0000 ',
  supplier_reference: ' REF-123 ',
  notes: ' Deliver to TEST site. ',
  subtotal_ex_gst: '25.00',
  gst_total: '2.50',
  approved_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  updated_at: '2026-11-19T02:00:00.000Z',
  ...overrides,
});

const itemRow = (overrides = {}) => ({
  id: ITEM_ID,
  company_id: COMPANY_ID,
  purchase_order_id: ORDER_ID,
  line_number: 1,
  description: ' Test materials ',
  quantity: '2.0000',
  unit_price_ex_gst: '12.5000',
  tax_code: 'gst',
  tax_rate: '0.100000',
  line_subtotal_ex_gst: '25.00',
  line_gst: '2.50',
  line_total_inc_gst: '27.50',
  ...overrides,
});

const createTableHarness = ({
  listData = [],
  listError = null,
  detailData = detailRow(),
  detailError = null,
  itemData = [itemRow()],
  itemError = null,
} = {}) => {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(['from', table]);
      const query = {
        select(fields) {
          calls.push(['select', table, fields]);
          return this;
        },
        eq(column, value) {
          calls.push(['eq', table, column, value]);
          return this;
        },
        async maybeSingle() {
          calls.push(['maybeSingle', table]);
          return { data: detailData, error: detailError };
        },
        async order(column, options) {
          calls.push(['order', table, column, options]);
          if (table === 'purchase_order_items') return { data: itemData, error: itemError };
          return { data: listData, error: listError };
        },
      };
      return query;
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

test('listing uses exact company and verified-Job filters with newest-first ordering', async () => {
  const harness = createTableHarness({ listData: [listRow()] });
  const orders = await createPurchaseOrdersReadAdapter(harness.from).list(COMPANY_ID, JOB_ID);
  assert.deepEqual(harness.calls, [
    ['from', 'purchase_orders'],
    ['select', 'purchase_orders', PURCHASE_ORDER_LIST_FIELDS],
    ['eq', 'purchase_orders', 'company_id', COMPANY_ID],
    ['eq', 'purchase_orders', 'job_id', JOB_ID],
    ['order', 'purchase_orders', 'created_at', { ascending: false }],
  ]);
  assert.deepEqual(orders, [{
    id: ORDER_ID,
    company_id: COMPANY_ID,
    job_id: JOB_ID,
    po_number: 'PO-000123',
    supplier_name: 'Test Supplier',
    status: 'draft',
    total_inc_gst: 27.5,
    currency_code: 'AUD',
    created_at: '2026-11-19T01:00:00.000Z',
  }]);
});

test('empty list stays empty and read failures propagate without fallback', async () => {
  assert.deepEqual(await createPurchaseOrdersReadAdapter(createTableHarness({ listData: null }).from).list(COMPANY_ID, JOB_ID), []);
  const failure = Object.assign(new Error('permission denied'), { code: '42501' });
  await assert.rejects(
    () => createPurchaseOrdersReadAdapter(createTableHarness({ listError: failure }).from).list(COMPANY_ID, JOB_ID),
    candidate => candidate === failure
  );
});

test('invalid company and Job IDs fail before a table query', async () => {
  const harness = createTableHarness();
  const adapter = createPurchaseOrdersReadAdapter(harness.from);
  await assert.rejects(() => adapter.list('invalid', JOB_ID));
  await assert.rejects(() => adapter.list(COMPANY_ID, 'invalid'));
  assert.deepEqual(harness.calls, []);
});

test('list mapping rejects cross-company, cross-Job and malformed records', () => {
  assert.throws(() => mapPurchaseOrderListRow(listRow({ company_id: OTHER_COMPANY_ID }), COMPANY_ID, JOB_ID), /crossed/);
  assert.throws(() => mapPurchaseOrderListRow(listRow({ job_id: OTHER_JOB_ID }), COMPANY_ID, JOB_ID), /crossed/);
  assert.throws(() => mapPurchaseOrderListRow(listRow({ id: 'bad' }), COMPANY_ID, JOB_ID));
  assert.throws(() => mapPurchaseOrderListRow(listRow({ po_number: '123' }), COMPANY_ID, JOB_ID));
  assert.throws(() => mapPurchaseOrderListRow(listRow({ created_at: 'bad' }), COMPANY_ID, JOB_ID));
});

test('draft, approved and cancelled status identifiers are preserved exactly', () => {
  for (const status of ['draft', 'approved', 'cancelled']) {
    assert.equal(mapPurchaseOrderListRow(listRow({ status }), COMPANY_ID, JOB_ID).status, status);
  }
  assert.throws(() => mapPurchaseOrderListRow(listRow({ status: 'submitted' }), COMPANY_ID, JOB_ID));
});

test('only canonical AUD and nonnegative stored totals are accepted', () => {
  assert.equal(mapPurchaseOrderListRow(listRow(), COMPANY_ID, JOB_ID).currency_code, 'AUD');
  for (const row of [
    listRow({ currency_code: 'USD' }),
    listRow({ currency_code: 'aud' }),
    listRow({ currency_code: 'not-money' }),
    listRow({ total_inc_gst: '-1.00' }),
    listRow({ total_inc_gst: '1.001' }),
  ]) assert.throws(() => mapPurchaseOrderListRow(row, COMPANY_ID, JOB_ID));
});

test('detail read pins header to company, Job and order before reading ordered items', async () => {
  const harness = createTableHarness();
  const order = await createPurchaseOrdersReadAdapter(harness.from).get(COMPANY_ID, JOB_ID, ORDER_ID);
  assert.equal(order.id, ORDER_ID);
  assert.equal(order.items[0].description, 'Test materials');
  assert.deepEqual(harness.calls, [
    ['from', 'purchase_orders'],
    ['select', 'purchase_orders', PURCHASE_ORDER_DETAIL_FIELDS],
    ['eq', 'purchase_orders', 'company_id', COMPANY_ID],
    ['eq', 'purchase_orders', 'job_id', JOB_ID],
    ['eq', 'purchase_orders', 'id', ORDER_ID],
    ['maybeSingle', 'purchase_orders'],
    ['from', 'purchase_order_items'],
    ['select', 'purchase_order_items', PURCHASE_ORDER_ITEM_FIELDS],
    ['eq', 'purchase_order_items', 'company_id', COMPANY_ID],
    ['eq', 'purchase_order_items', 'purchase_order_id', ORDER_ID],
    ['order', 'purchase_order_items', 'line_number', { ascending: true }],
  ]);
});

test('unknown order returns null without issuing a line-item query', async () => {
  const harness = createTableHarness({ detailData: null });
  assert.equal(await createPurchaseOrdersReadAdapter(harness.from).get(COMPANY_ID, JOB_ID, ORDER_ID), null);
  assert.equal(harness.calls.some(call => call[1] === 'purchase_order_items'), false);
});

test('detail mapping exposes only confirmed supplier, lifecycle, totals and line fields', () => {
  const order = mapPurchaseOrderDetails(detailRow(), [itemRow()], COMPANY_ID, JOB_ID, ORDER_ID);
  assert.deepEqual(Object.keys(order), [
    'id', 'company_id', 'job_id', 'po_number', 'supplier_name', 'status', 'total_inc_gst',
    'currency_code', 'created_at', 'supplier_contact_name', 'supplier_email', 'supplier_phone',
    'supplier_reference', 'notes', 'subtotal_ex_gst', 'gst_total', 'approved_at', 'cancelled_at',
    'cancellation_reason', 'updated_at', 'items',
  ]);
  assert.equal(order.supplier_contact_name, 'Casey Contact');
  assert.equal(order.subtotal_ex_gst, 25);
  assert.equal(order.gst_total, 2.5);
  assert.equal('approved_by' in order, false);
});

test('line-item mapping preserves stored GST values and confirmed calculation rules', () => {
  const gst = mapPurchaseOrderItemRow(itemRow(), COMPANY_ID, ORDER_ID);
  assert.equal(gst.quantity, 2);
  assert.equal(gst.unit_price_ex_gst, 12.5);
  assert.equal(gst.line_total_inc_gst, 27.5);
  const free = mapPurchaseOrderItemRow(itemRow({
    tax_code: 'gst_free',
    tax_rate: '0.000000',
    line_gst: '0.00',
    line_total_inc_gst: '25.00',
  }), COMPANY_ID, ORDER_ID);
  assert.equal(free.tax_code, 'gst_free');
  assert.equal(free.line_gst, 0);
});

test('cross-order items, invalid numeric fields and inconsistent totals fail closed', () => {
  for (const row of [
    itemRow({ company_id: OTHER_COMPANY_ID }),
    itemRow({ purchase_order_id: OTHER_ORDER_ID }),
    itemRow({ quantity: 0 }),
    itemRow({ line_number: 0 }),
    itemRow({ tax_rate: '0.2' }),
    itemRow({ line_subtotal_ex_gst: '24.99' }),
    itemRow({ line_total_inc_gst: '30.00' }),
  ]) assert.throws(() => mapPurchaseOrderItemRow(row, COMPANY_ID, ORDER_ID));
});

test('detail mapping rejects cross-Job headers, unordered lines and malformed envelopes', () => {
  assert.throws(() => mapPurchaseOrderDetails(detailRow({ job_id: OTHER_JOB_ID }), [], COMPANY_ID, JOB_ID, ORDER_ID));
  assert.throws(() => mapPurchaseOrderDetails(detailRow(), {}, COMPANY_ID, JOB_ID, ORDER_ID));
  assert.throws(() => mapPurchaseOrderDetails(detailRow(), [], COMPANY_ID, JOB_ID, ORDER_ID));
  assert.throws(() => mapPurchaseOrderDetails(detailRow(), [itemRow({ line_number: 2 })], COMPANY_ID, JOB_ID, ORDER_ID));
  assert.throws(() => mapPurchaseOrderDetails(detailRow({ total_inc_gst: '27.49' }), [itemRow()], COMPANY_ID, JOB_ID, ORDER_ID));
  const empty = mapPurchaseOrderDetails(detailRow({
    subtotal_ex_gst: '0.00', gst_total: '0.00', total_inc_gst: '0.00',
  }), [], COMPANY_ID, JOB_ID, ORDER_ID);
  assert.deepEqual(empty.items, []);
});

test('draft, approved, draft-cancelled and approved-cancelled lifecycle shapes validate', () => {
  assert.equal(mapPurchaseOrderDetails(detailRow(), [itemRow()], COMPANY_ID, JOB_ID, ORDER_ID).status, 'draft');
  assert.equal(mapPurchaseOrderDetails(detailRow({
    status: 'approved', approved_at: '2026-11-20T01:00:00Z',
  }), [itemRow()], COMPANY_ID, JOB_ID, ORDER_ID).status, 'approved');
  assert.equal(mapPurchaseOrderDetails(detailRow({
    status: 'cancelled', cancelled_at: '2026-11-20T01:00:00Z',
  }), [itemRow()], COMPANY_ID, JOB_ID, ORDER_ID).status, 'cancelled');
  assert.equal(mapPurchaseOrderDetails(detailRow({
    status: 'cancelled',
    approved_at: '2026-11-20T01:00:00Z',
    cancelled_at: '2026-11-21T01:00:00Z',
    cancellation_reason: 'No longer required',
  }), [itemRow()], COMPANY_ID, JOB_ID, ORDER_ID).status, 'cancelled');
  assert.throws(() => mapPurchaseOrderDetails(detailRow({ status: 'approved' }), [itemRow()], COMPANY_ID, JOB_ID, ORDER_ID));
});

test('authenticated workspace, membership and verified matching Job are mandatory', () => {
  assert.equal(resolvePurchaseOrderReadScope({ jobScope: null, job: job() }), null);
  assert.equal(resolvePurchaseOrderReadScope({ jobScope: jobScope(), job: null }), null);
  assert.equal(resolvePurchaseOrderReadScope({ jobScope: { ...jobScope(), userId: '' }, job: job() }), null);
  assert.equal(resolvePurchaseOrderReadScope({ jobScope: jobScope(), job: job({ company_id: OTHER_COMPANY_ID }) }), null);
  assert.equal(resolvePurchaseOrderReadScope({ jobScope: jobScope(), job: job({ id: 'bad' }) }), null);
});

test('Worker, Admin and Owner receive the committed company-member read scope', () => {
  for (const role of ['worker', 'admin', 'owner']) {
    const scope = resolvePurchaseOrderReadScope({ jobScope: jobScope(role), job: job() });
    assert.equal(scope.role, role);
    assert.equal(scope.companyId, COMPANY_ID);
    assert.equal(scope.jobId, JOB_ID);
  }
  assert.equal(resolvePurchaseOrderReadScope({ jobScope: jobScope('supervisor'), job: job() }), null);
});

test('identity, company, role, Job and order changes produce distinct request keys', () => {
  const scope = resolvePurchaseOrderReadScope({ jobScope: jobScope(), job: job() });
  assert.notEqual(createPurchaseOrderScopeKey(scope), createPurchaseOrderScopeKey({ ...scope, userId: OTHER_USER_ID }));
  assert.notEqual(createPurchaseOrderScopeKey(scope), createPurchaseOrderScopeKey({ ...scope, companyId: OTHER_COMPANY_ID }));
  assert.notEqual(createPurchaseOrderScopeKey(scope), createPurchaseOrderScopeKey({ ...scope, role: 'admin' }));
  assert.notEqual(createPurchaseOrderScopeKey(scope), createPurchaseOrderScopeKey({ ...scope, jobId: OTHER_JOB_ID }));
  assert.notEqual(createPurchaseOrderRequestKey(scope, ORDER_ID), createPurchaseOrderRequestKey(scope, OTHER_ORDER_ID));
  assert.equal(createPurchaseOrderRequestKey(scope, 'bad'), null);
});

test('permission-denied detection distinguishes access failures from general errors', () => {
  assert.equal(isPurchaseOrderPermissionError({ code: '42501' }), true);
  assert.equal(isPurchaseOrderPermissionError(new Error('not authorized for active company')), true);
  assert.equal(isPurchaseOrderPermissionError(new Error('network unavailable')), false);
});

test('page integration waits for verified Job context and clears stale list/detail records', () => {
  const parent = readSource('src/pages/JobModuleRecords.jsx');
  const component = readSource('src/components/purchase-orders/PurchaseOrderRecords.jsx');
  assert.match(parent, /onsiteApi\.jobs\.get\(jobScope\.companyId, normalizedJobId\)/);
  assert.match(parent, /module\.key === 'purchase-orders'/);
  assert.match(parent, /<PurchaseOrderRecords jobScope=\{jobScope\} job=\{visibleJob\}/);
  assert.ok(parent.indexOf("visibleJobState !== 'ready'") < parent.indexOf('<PurchaseOrderRecords'));
  assert.match(component, /setOrders\(\[\]\)/);
  assert.match(component, /setDetail\(null\)/);
  assert.match(component, /requestId !== listRequestIdRef\.current/);
  assert.match(component, /requestId !== detailRequestIdRef\.current/);
  assert.match(component, /resultScopeKey === scopeKey/);
  assert.match(component, /detailResultKey === detailRequestKey/);
});

test('Purchase Orders integration exposes list/detail only with no mutation or export controls', () => {
  const files = [
    'src/api/supabase/purchase-orders-read-adapter.js',
    'src/components/purchase-orders/PurchaseOrderRecords.jsx',
    'src/lib/purchase-order-access.js',
  ].map(readSource).join('\n').toLowerCase();
  for (const token of [
    '.insert(', '.update(', '.delete(', '.upsert(', '.rpc(', 'create_purchase_order_admin',
    'update_purchase_order_draft_admin', 'approve_purchase_order_admin', 'cancel_purchase_order_admin',
    'generate pdf', 'export purchase orders', 'download=', 'jspdf', 'blob(', 'send order', 'service_role',
  ]) assert.equal(files.includes(token), false, token);
});

test('Purchase Order presentation uses stored totals, lifecycle labels and Australian formatting', () => {
  const source = readSource('src/components/purchase-orders/PurchaseOrderRecords.jsx');
  assert.match(source, /draft: 'Draft'/);
  assert.match(source, /approved: 'Approved'/);
  assert.match(source, /cancelled: 'Cancelled'/);
  assert.match(source, /Intl\.NumberFormat\('en-AU'/);
  assert.match(source, /order\.subtotal_ex_gst/);
  assert.match(source, /order\.gst_total/);
  assert.match(source, /order\.total_inc_gst/);
  assert.match(source, /GST 10%/);
  assert.match(source, /GST-free/);
});

test('other four job-first shells and all previous navigation remain unchanged', () => {
  assert.deepEqual(Object.keys(JOB_FIRST_MODULES), [
    'pre-starts', 'toolbox-talks', 'site-diaries', 'site-photos', 'purchase-orders',
  ]);
  const parent = readSource('src/pages/JobModuleRecords.jsx');
  assert.match(parent, /Module integration pending/);
  assert.match(parent, /no module records have been requested, cached or fabricated/);
  for (const key of ['pre-starts', 'toolbox-talks', 'site-diaries', 'site-photos']) {
    assert.equal(JOB_FIRST_MODULES[key].jobFirst, true);
  }
});
