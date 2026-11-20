const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PO_NUMBER_PATTERN = /^PO-[0-9]{6,}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const PURCHASE_ORDER_STATUSES = new Set(['draft', 'approved', 'cancelled']);
const PURCHASE_ORDER_TAX_CODES = new Set(['gst', 'gst_free']);

export const PURCHASE_ORDER_LIST_FIELDS = [
  'id',
  'company_id',
  'job_id',
  'po_number',
  'supplier_name',
  'status',
  'total_inc_gst',
  'currency_code',
  'created_at',
].join(',');

export const PURCHASE_ORDER_DETAIL_FIELDS = [
  PURCHASE_ORDER_LIST_FIELDS,
  'supplier_contact_name',
  'supplier_email',
  'supplier_phone',
  'supplier_reference',
  'notes',
  'subtotal_ex_gst',
  'gst_total',
  'approved_at',
  'cancelled_at',
  'cancellation_reason',
  'updated_at',
].join(',');

export const PURCHASE_ORDER_ITEM_FIELDS = [
  'id',
  'company_id',
  'purchase_order_id',
  'line_number',
  'description',
  'quantity',
  'unit_price_ex_gst',
  'tax_code',
  'tax_rate',
  'line_subtotal_ex_gst',
  'line_gst',
  'line_total_inc_gst',
].join(',');

const invalidResponse = field => new Error(`Purchase Orders query returned an invalid ${field}`);

const requiredUuid = (value, field) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) throw invalidResponse(field);
  return value.trim().toLowerCase();
};

const requiredText = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw invalidResponse(field);
  return value.trim();
};

const optionalText = (value, field) => {
  if (value === null) return null;
  if (typeof value !== 'string') throw invalidResponse(field);
  return value.trim() || null;
};

const requiredTimestamp = (value, field) => {
  const timestamp = requiredText(value, field);
  if (Number.isNaN(Date.parse(timestamp))) throw invalidResponse(field);
  return timestamp;
};

const optionalTimestamp = (value, field) => {
  if (value === null) return null;
  return requiredTimestamp(value, field);
};

const decimal = (value, field, { positive = false, scale }) => {
  if (typeof value !== 'number' && typeof value !== 'string') throw invalidResponse(field);
  const source = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(source)) throw invalidResponse(field);
  const fraction = source.split('.')[1] ?? '';
  const number = Number(source);
  if (!Number.isFinite(number) || fraction.length > scale || (positive ? number <= 0 : number < 0)) {
    throw invalidResponse(field);
  }
  return number;
};

const money = (value, field) => decimal(value, field, { scale: 2 });
const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;

const purchaseOrderStatus = (value) => {
  if (!PURCHASE_ORDER_STATUSES.has(value)) throw invalidResponse('status');
  return value;
};

const taxCode = (value) => {
  if (!PURCHASE_ORDER_TAX_CODES.has(value)) throw invalidResponse('tax code');
  return value;
};

export const mapPurchaseOrderListRow = (row, expectedCompanyId, expectedJobId, expectedOrderId = null) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalidResponse('order');
  const id = requiredUuid(row.id, 'order ID');
  const companyId = requiredUuid(row.company_id, 'company ID');
  const jobId = requiredUuid(row.job_id, 'Job ID');
  if (
    companyId !== expectedCompanyId
    || jobId !== expectedJobId
    || (expectedOrderId && id !== expectedOrderId)
  ) throw new Error('Purchase Orders query crossed the authorised company, Job, or order scope');

  const poNumber = requiredText(row.po_number, 'PO number');
  if (!PO_NUMBER_PATTERN.test(poNumber)) throw invalidResponse('PO number');
  const currencyCode = requiredText(row.currency_code, 'currency code');
  if (!CURRENCY_PATTERN.test(currencyCode) || currencyCode !== 'AUD') {
    throw invalidResponse('currency code');
  }

  return {
    id,
    company_id: companyId,
    job_id: jobId,
    po_number: poNumber,
    supplier_name: requiredText(row.supplier_name, 'supplier name'),
    status: purchaseOrderStatus(row.status),
    total_inc_gst: money(row.total_inc_gst, 'total including GST'),
    currency_code: currencyCode,
    created_at: requiredTimestamp(row.created_at, 'created date'),
  };
};

export const mapPurchaseOrderItemRow = (row, expectedCompanyId, expectedOrderId) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalidResponse('line item');
  const companyId = requiredUuid(row.company_id, 'line-item company ID');
  const purchaseOrderId = requiredUuid(row.purchase_order_id, 'line-item order ID');
  if (companyId !== expectedCompanyId || purchaseOrderId !== expectedOrderId) {
    throw new Error('Purchase Order query returned an item from another company or order');
  }
  if (!Number.isInteger(row.line_number) || row.line_number <= 0) throw invalidResponse('line number');

  const quantity = decimal(row.quantity, 'quantity', { positive: true, scale: 4 });
  const unitPriceExGst = decimal(row.unit_price_ex_gst, 'unit price', { scale: 4 });
  const itemTaxCode = taxCode(row.tax_code);
  const taxRate = decimal(row.tax_rate, 'tax rate', { scale: 6 });
  if ((itemTaxCode === 'gst' && taxRate !== 0.1) || (itemTaxCode === 'gst_free' && taxRate !== 0)) {
    throw invalidResponse('tax rate');
  }

  const lineSubtotalExGst = money(row.line_subtotal_ex_gst, 'line subtotal');
  const lineGst = money(row.line_gst, 'line GST');
  const lineTotalIncGst = money(row.line_total_inc_gst, 'line total');
  if (
    lineSubtotalExGst !== roundMoney(quantity * unitPriceExGst)
    || lineGst !== roundMoney(lineSubtotalExGst * taxRate)
    || lineTotalIncGst !== roundMoney(lineSubtotalExGst + lineGst)
  ) throw invalidResponse('line totals');

  return {
    id: requiredUuid(row.id, 'line-item ID'),
    company_id: companyId,
    purchase_order_id: purchaseOrderId,
    line_number: row.line_number,
    description: requiredText(row.description, 'line-item description'),
    quantity,
    unit_price_ex_gst: unitPriceExGst,
    tax_code: itemTaxCode,
    tax_rate: taxRate,
    line_subtotal_ex_gst: lineSubtotalExGst,
    line_gst: lineGst,
    line_total_inc_gst: lineTotalIncGst,
  };
};

export const mapPurchaseOrderDetails = (header, itemRows, expectedCompanyId, expectedJobId, expectedOrderId) => {
  const order = mapPurchaseOrderListRow(header, expectedCompanyId, expectedJobId, expectedOrderId);
  if (!Array.isArray(itemRows)) throw invalidResponse('line items');

  const subtotalExGst = money(header.subtotal_ex_gst, 'subtotal');
  const gstTotal = money(header.gst_total, 'GST total');
  if (order.total_inc_gst !== roundMoney(subtotalExGst + gstTotal)) throw invalidResponse('order totals');

  const approvedAt = optionalTimestamp(header.approved_at, 'approval date');
  const cancelledAt = optionalTimestamp(header.cancelled_at, 'cancellation date');
  const cancellationReason = optionalText(header.cancellation_reason, 'cancellation reason');
  const lifecycleIsValid = (
    (order.status === 'draft' && approvedAt === null && cancelledAt === null && cancellationReason === null)
    || (order.status === 'approved' && approvedAt !== null && cancelledAt === null && cancellationReason === null)
    || (
      order.status === 'cancelled'
      && cancelledAt !== null
      && (approvedAt === null || cancellationReason !== null)
    )
  );
  if (!lifecycleIsValid) throw invalidResponse('lifecycle');

  const items = itemRows.map(row => mapPurchaseOrderItemRow(row, expectedCompanyId, expectedOrderId));
  for (let index = 0; index < items.length; index += 1) {
    if (items[index].line_number !== index + 1) throw invalidResponse('line ordering');
  }
  const itemSubtotal = roundMoney(items.reduce((total, item) => total + item.line_subtotal_ex_gst, 0));
  const itemGst = roundMoney(items.reduce((total, item) => total + item.line_gst, 0));
  const itemTotal = roundMoney(items.reduce((total, item) => total + item.line_total_inc_gst, 0));
  if (itemSubtotal !== subtotalExGst || itemGst !== gstTotal || itemTotal !== order.total_inc_gst) {
    throw invalidResponse('order and line totals');
  }

  return {
    ...order,
    supplier_contact_name: optionalText(header.supplier_contact_name, 'supplier contact name'),
    supplier_email: optionalText(header.supplier_email, 'supplier email'),
    supplier_phone: optionalText(header.supplier_phone, 'supplier phone'),
    supplier_reference: optionalText(header.supplier_reference, 'supplier reference'),
    notes: optionalText(header.notes, 'notes'),
    subtotal_ex_gst: subtotalExGst,
    gst_total: gstTotal,
    approved_at: approvedAt,
    cancelled_at: cancelledAt,
    cancellation_reason: cancellationReason,
    updated_at: requiredTimestamp(header.updated_at, 'updated date'),
    items,
  };
};

export const createPurchaseOrdersReadAdapter = (from) => {
  if (typeof from !== 'function') throw new Error('A Supabase table client is required');

  return {
    async list(companyId, jobId) {
      const normalizedCompanyId = requiredUuid(companyId, 'company ID');
      const normalizedJobId = requiredUuid(jobId, 'Job ID');
      const { data, error } = await from('purchase_orders')
        .select(PURCHASE_ORDER_LIST_FIELDS)
        .eq('company_id', normalizedCompanyId)
        .eq('job_id', normalizedJobId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (data !== null && !Array.isArray(data)) throw invalidResponse('order list');
      return (data ?? []).map(row => mapPurchaseOrderListRow(row, normalizedCompanyId, normalizedJobId));
    },

    async get(companyId, jobId, purchaseOrderId) {
      const normalizedCompanyId = requiredUuid(companyId, 'company ID');
      const normalizedJobId = requiredUuid(jobId, 'Job ID');
      const normalizedOrderId = requiredUuid(purchaseOrderId, 'order ID');
      const { data: header, error: headerError } = await from('purchase_orders')
        .select(PURCHASE_ORDER_DETAIL_FIELDS)
        .eq('company_id', normalizedCompanyId)
        .eq('job_id', normalizedJobId)
        .eq('id', normalizedOrderId)
        .maybeSingle();
      if (headerError) throw headerError;
      if (!header) return null;

      const { data: items, error: itemError } = await from('purchase_order_items')
        .select(PURCHASE_ORDER_ITEM_FIELDS)
        .eq('company_id', normalizedCompanyId)
        .eq('purchase_order_id', normalizedOrderId)
        .order('line_number', { ascending: true });
      if (itemError) throw itemError;
      return mapPurchaseOrderDetails(header, items ?? [], normalizedCompanyId, normalizedJobId, normalizedOrderId);
    },
  };
};
