import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  ReceiptText,
  ShieldCheck,
  ShoppingCart,
} from 'lucide-react';
import { onsiteApi } from '@/api/supabase/adapter';
import {
  createPurchaseOrderRequestKey,
  createPurchaseOrderScopeKey,
  isPurchaseOrderPermissionError,
  resolvePurchaseOrderReadScope,
} from '@/lib/purchase-order-access';

const STATUS_LABELS = {
  draft: 'Draft',
  approved: 'Approved',
  cancelled: 'Cancelled',
};

const STATUS_STYLES = {
  draft: 'bg-amber-500/10 text-amber-400',
  approved: 'bg-emerald-500/10 text-emerald-400',
  cancelled: 'bg-rose-500/10 text-rose-400',
};

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', worker: 'Worker' };

const formatMoney = (amount, currencyCode) => new Intl.NumberFormat('en-AU', {
  currency: currencyCode,
  currencyDisplay: 'symbol',
  style: 'currency',
}).format(amount);

const formatDate = value => new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
}).format(new Date(value));

const formatDateTime = value => new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short',
  year: 'numeric',
}).format(new Date(value));

const formatQuantity = value => new Intl.NumberFormat('en-AU', {
  maximumFractionDigits: 4,
}).format(value);

export default function PurchaseOrderRecords({ jobScope, job }) {
  const listRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const [orders, setOrders] = useState([]);
  const [listState, setListState] = useState('loading');
  const [resultScopeKey, setResultScopeKey] = useState(null);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailState, setDetailState] = useState('idle');
  const [detailResultKey, setDetailResultKey] = useState(null);

  const scope = useMemo(() => resolvePurchaseOrderReadScope({ jobScope, job }), [job, jobScope]);
  const scopeKey = createPurchaseOrderScopeKey(scope);
  const hasCurrentList = Boolean(scopeKey) && resultScopeKey === scopeKey;
  const visibleOrders = useMemo(() => hasCurrentList ? orders : [], [hasCurrentList, orders]);
  const visibleListState = !scope
    ? 'unavailable'
    : hasCurrentList
      ? listState
      : 'loading';
  const selectedOrderIsCurrent = Boolean(selectedOrderId)
    && visibleOrders.some(order => order.id === selectedOrderId);
  const detailRequestKey = selectedOrderIsCurrent
    ? createPurchaseOrderRequestKey(scope, selectedOrderId)
    : null;
  const hasCurrentDetail = Boolean(detailRequestKey) && detailResultKey === detailRequestKey;
  const visibleDetail = hasCurrentDetail ? detail : null;
  const visibleDetailState = !selectedOrderId
    ? 'idle'
    : !selectedOrderIsCurrent
      ? 'unavailable'
      : hasCurrentDetail
        ? detailState
        : 'loading';

  useEffect(() => {
    const requestId = listRequestIdRef.current + 1;
    listRequestIdRef.current = requestId;
    setOrders([]);
    setResultScopeKey(null);
    setSelectedOrderId(null);
    setDetail(null);
    setDetailResultKey(null);

    if (!scope || !scopeKey) {
      setListState('unavailable');
      return;
    }

    setListState('loading');
    onsiteApi.purchaseOrdersRead.list(scope.companyId, scope.jobId)
      .then(result => {
        if (requestId !== listRequestIdRef.current) return;
        setOrders(result);
        setResultScopeKey(scopeKey);
        setListState(result.length === 0 ? 'empty' : 'ready');
      })
      .catch(error => {
        if (requestId !== listRequestIdRef.current) return;
        console.error('Failed to load Supabase Purchase Orders:', error);
        setOrders([]);
        setResultScopeKey(scopeKey);
        setListState(isPurchaseOrderPermissionError(error) ? 'denied' : 'error');
      });

    return () => { listRequestIdRef.current += 1; };
  }, [scope, scopeKey]);

  useEffect(() => {
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    setDetail(null);
    setDetailResultKey(null);

    if (!scope || !detailRequestKey || !selectedOrderIsCurrent) {
      setDetailState(selectedOrderId ? 'unavailable' : 'idle');
      return;
    }

    setDetailState('loading');
    onsiteApi.purchaseOrdersRead.get(scope.companyId, scope.jobId, selectedOrderId)
      .then(result => {
        if (requestId !== detailRequestIdRef.current) return;
        setDetail(result);
        setDetailResultKey(detailRequestKey);
        setDetailState(result ? 'ready' : 'unavailable');
      })
      .catch(error => {
        if (requestId !== detailRequestIdRef.current) return;
        console.error('Failed to load Supabase Purchase Order details:', error);
        setDetail(null);
        setDetailResultKey(detailRequestKey);
        setDetailState(isPurchaseOrderPermissionError(error) ? 'denied' : 'error');
      });

    return () => { detailRequestIdRef.current += 1; };
  }, [detailRequestKey, scope, selectedOrderId, selectedOrderIsCurrent]);

  return (
    <section className="min-w-0 rounded-3xl border border-border bg-card p-6 sm:p-8" aria-label="Purchase Orders records">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <ShoppingCart className="h-5 w-5" aria-hidden="true" />
            <p className="text-xs font-black uppercase tracking-[0.16em]">Read-only orders</p>
          </div>
          <h2 className="mt-3 text-xl font-black">Purchase Orders</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {scope ? `${scope.jobName} · ${ROLE_LABELS[scope.role]}` : 'Verified job access required'}
          </p>
        </div>
        <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-primary">
          View only
        </span>
      </div>

      {visibleListState === 'loading' && <PurchaseOrderNotice icon={ShoppingCart} title="Loading Purchase Orders" message="Reading orders for the verified company and Job." />}
      {visibleListState === 'unavailable' && <PurchaseOrderNotice alert icon={ShieldCheck} title="Purchase Orders unavailable" message="An authenticated company membership and verified Job are required." />}
      {visibleListState === 'denied' && <PurchaseOrderNotice alert icon={ShieldCheck} title="Purchase Order access restricted" message="Supabase denied this company-and-Job read. No broader or privileged fallback was attempted." />}
      {visibleListState === 'error' && <PurchaseOrderNotice alert icon={AlertTriangle} title="Purchase Orders unavailable" message="Orders could not be loaded. No previous-company or previous-Job records are displayed." />}
      {visibleListState === 'empty' && <PurchaseOrderNotice icon={ReceiptText} title="No Purchase Orders" message="No orders were found for this Job." />}

      {visibleListState === 'ready' && (
        <div className="mt-6 grid gap-3" aria-label="Purchase Order list">
          {visibleOrders.map(order => (
            <article key={order.id} className={`rounded-2xl border p-4 ${selectedOrderId === order.id ? 'border-primary/50 bg-primary/5' : 'border-border bg-secondary/30'}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-mono text-sm font-black">{order.po_number}</h3>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${STATUS_STYLES[order.status]}`}>
                      {STATUS_LABELS[order.status]}
                    </span>
                  </div>
                  <p className="mt-2 truncate font-bold">{order.supplier_name}</p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatDate(order.created_at)}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <p className="text-lg font-black text-primary">{formatMoney(order.total_inc_gst, order.currency_code)}</p>
                  <button
                    type="button"
                    onClick={() => setSelectedOrderId(order.id)}
                    className="min-h-11 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    View order
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {visibleDetailState === 'loading' && <PurchaseOrderNotice icon={ReceiptText} title="Loading order details" message="Reading the selected order and its line items." />}
      {visibleDetailState === 'unavailable' && <PurchaseOrderNotice alert icon={ShieldCheck} title="Order unavailable" message="The selected order is not available for this company and Job." />}
      {visibleDetailState === 'denied' && <PurchaseOrderNotice alert icon={ShieldCheck} title="Order access restricted" message="Supabase denied this order detail read. No fallback was attempted." />}
      {visibleDetailState === 'error' && <PurchaseOrderNotice alert icon={AlertTriangle} title="Order details unavailable" message="The selected order could not be loaded safely." />}
      {visibleDetailState === 'ready' && visibleDetail && <PurchaseOrderDetail order={visibleDetail} />}
    </section>
  );
}

const PurchaseOrderDetail = ({ order }) => (
  <div className="mt-8 border-t border-border pt-6" aria-label={`Purchase Order ${order.po_number} details`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="font-mono text-xs font-black text-primary">{order.po_number}</p>
        <h3 className="mt-1 text-xl font-black">{order.supplier_name}</h3>
        <p className="mt-1 text-xs text-muted-foreground">Updated {formatDateTime(order.updated_at)}</p>
      </div>
      <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${STATUS_STYLES[order.status]}`}>
        {STATUS_LABELS[order.status]}
      </span>
    </div>

    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      <DetailCard icon={Building2} title="Supplier">
        {order.supplier_contact_name && <p>{order.supplier_contact_name}</p>}
        {order.supplier_reference && <p>Reference: {order.supplier_reference}</p>}
        {order.supplier_email && <p>{order.supplier_email}</p>}
        {order.supplier_phone && <p>{order.supplier_phone}</p>}
        {!order.supplier_contact_name && !order.supplier_reference && !order.supplier_email && !order.supplier_phone && <p>No additional supplier details.</p>}
      </DetailCard>
      <DetailCard icon={CalendarDays} title="Lifecycle">
        <p>Created: {formatDateTime(order.created_at)}</p>
        {order.approved_at && <p>Approved: {formatDateTime(order.approved_at)}</p>}
        {order.cancelled_at && <p>Cancelled: {formatDateTime(order.cancelled_at)}</p>}
        {order.cancellation_reason && <p>Reason: {order.cancellation_reason}</p>}
      </DetailCard>
    </div>

    {order.notes && (
      <div className="mt-3 rounded-2xl bg-secondary/40 p-4">
        <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">Order notes</p>
        <p className="mt-2 text-sm leading-6">{order.notes}</p>
      </div>
    )}

    <div className="mt-5 overflow-hidden rounded-2xl border border-border">
      <div className="border-b border-border bg-secondary/50 px-4 py-3">
        <h4 className="text-sm font-black">Line items</h4>
      </div>
      {order.items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">This order has no line items.</p>
      ) : (
        <div className="divide-y divide-border">
          {order.items.map(item => (
            <div key={item.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <p className="font-bold">{item.line_number}. {item.description}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatQuantity(item.quantity)} × {formatMoney(item.unit_price_ex_gst, order.currency_code)} · {item.tax_code === 'gst' ? 'GST 10%' : 'GST-free'}
                </p>
              </div>
              <p className="font-black">{formatMoney(item.line_total_inc_gst, order.currency_code)}</p>
            </div>
          ))}
        </div>
      )}
    </div>

    <dl className="ml-auto mt-5 grid max-w-sm grid-cols-[1fr_auto] gap-x-5 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Subtotal ex GST</dt>
      <dd className="text-right font-bold">{formatMoney(order.subtotal_ex_gst, order.currency_code)}</dd>
      <dt className="text-muted-foreground">GST</dt>
      <dd className="text-right font-bold">{formatMoney(order.gst_total, order.currency_code)}</dd>
      <dt className="border-t border-border pt-3 font-black">Total inc GST</dt>
      <dd className="border-t border-border pt-3 text-right text-lg font-black text-primary">{formatMoney(order.total_inc_gst, order.currency_code)}</dd>
    </dl>
  </div>
);

const DetailCard = ({ icon: Icon, title, children }) => (
  <div className="rounded-2xl bg-secondary/40 p-4 text-sm">
    <div className="flex items-center gap-2 font-black">
      <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
      {title}
    </div>
    <div className="mt-2 space-y-1 break-words text-xs leading-5 text-muted-foreground">{children}</div>
  </div>
);

const PurchaseOrderNotice = ({ icon: Icon, title, message, alert = false }) => (
  <div className={`mt-6 rounded-2xl border p-7 text-center ${alert ? 'border-amber-400/20 bg-amber-400/5' : 'border-border bg-secondary/30'}`} role={alert ? 'alert' : 'status'}>
    <Icon className={`mx-auto h-8 w-8 ${alert ? 'text-amber-400' : 'text-primary'}`} aria-hidden="true" />
    <h3 className="mt-3 font-black">{title}</h3>
    <p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{message}</p>
  </div>
);
