'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, inr, dateShort } from '@/lib/fetch';
import { computeOrderSummary } from '@/lib/order-summary';

interface OrderItem {
  id: number;
  productId: number | null;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  taxPercent: number;
  lineTotal: number;
  product: { id: number; costPrice: number | null } | null;
}

interface Order {
  id: number;
  orderNumber: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerGstin: string | null;
  shippingAddress: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  discountAmount: number | null;
  couponCode: string | null;
  shippingCost: number | null;
  internalShippingCost: number | null;
  totalAmount: number | null;
  orderStatus: string;
  paymentStatus: string;
  paymentMethod: string | null;
  notes: string | null;
  internalNotes: string | null;
  createdAt: string;
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  items: OrderItem[];
}

export default function OrderDetail({ params }: { params: { id: string } }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const data = await api<{ order: Order }>(`/api/orders/${params.id}`);
    setOrder(data.order);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function setStatus(orderStatus: string) {
    setSaving(true);
    try {
      await api(`/api/orders/${params.id}`, { method: 'PATCH', body: JSON.stringify({ orderStatus }) });
      await load();
    } finally { setSaving(false); }
  }
  async function setPayment(paymentStatus: string) {
    setSaving(true);
    try {
      await api(`/api/orders/${params.id}`, { method: 'PATCH', body: JSON.stringify({ paymentStatus }) });
      await load();
    } finally { setSaving(false); }
  }

  if (!order) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-slate-500">Order</div>
          <h1 className="text-2xl font-semibold font-mono">{order.orderNumber}</h1>
          <div className="text-sm text-slate-500 mt-1">Placed {dateShort(order.createdAt)}</div>
        </div>
        <a href={`/api/orders/${order.id}/invoice`} target="_blank" rel="noopener" className="btn-outline">Download invoice</a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="label">Order status</div>
          <select className="input" value={order.orderStatus} onChange={e => setStatus(e.target.value)} disabled={saving}>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="shipped">Shipped</option>
            <option value="delivered">Delivered</option>
            <option value="cancelled">Cancelled</option>
            <option value="returned">Returned</option>
          </select>
        </div>
        <div className="card p-4">
          <div className="label">Payment status</div>
          <select className="input" value={order.paymentStatus} onChange={e => setPayment(e.target.value)} disabled={saving}>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
          </select>
          {order.paymentMethod && <div className="text-xs text-slate-500 mt-2">via {order.paymentMethod}</div>}
        </div>
        <div className="card p-4">
          <div className="label">Customer</div>
          <div className="text-sm font-medium">{order.customerName || '—'}</div>
          <div className="text-xs text-slate-500">{order.customerEmail}</div>
          <div className="text-xs text-slate-500">{order.customerPhone}</div>
          {order.customerGstin && (
            <div className="mt-1 text-xs font-mono text-slate-700">
              <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 mr-1">B2B</span>
              GSTIN: {order.customerGstin}
            </div>
          )}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-200 font-semibold">Items</div>
        {(() => {
          // Shared helper = same numbers + labels as the invoice / website /
          // print. GST on the discounted Net Value.
          const summary = computeOrderSummary(
            order.items.map((it) => ({
              name: it.productName,
              sku: it.productSku,
              hsnCode: null,
              lineInclusive: Number(it.lineTotal),
              quantity: it.quantity,
              taxPercent: Number(it.taxPercent),
            })),
            Number(order.discountAmount ?? 0),
            Number(order.shippingCost ?? 0),
          );
          const cell = 'px-4 py-2 text-right';
          const labelSpan = 6;
          return (
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                <tr>
                  <th className="px-4 py-2 text-left">Description</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Unit Price</th>
                  <th className="px-4 py-2 text-right">Discount</th>
                  <th className="px-4 py-2 text-right">GST</th>
                  <th className="px-4 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2">
                      <div>{l.name}</div>
                      <div className="font-mono text-[11px] text-slate-400">SKU: {l.sku}</div>
                    </td>
                    <td className="px-4 py-2 text-right">{l.quantity}</td>
                    <td className="px-4 py-2 text-right">{inr(l.unitNetPrice)}</td>
                    <td className="px-4 py-2 text-right text-emerald-600">
                      {l.lineDiscount > 0 ? inr(l.lineDiscount) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {inr(l.lineGst)} <span className="text-slate-400 text-xs">({l.taxPercent}%)</span>
                    </td>
                    <td className="px-4 py-2 text-right font-medium">{inr(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 text-sm">
                <tr><td colSpan={labelSpan} className={`${cell} text-slate-500`}>Excluding GST Price (Net Price)</td><td className={cell}>{inr(summary.netPrice)}</td></tr>
                {summary.discountPct > 0 && (
                  <tr><td colSpan={labelSpan} className={`${cell} text-emerald-600`}>Discount ({summary.discountPct}%)</td><td className={`${cell} text-emerald-600`}>− {inr(summary.discountAmount)}</td></tr>
                )}
                {summary.discountPct > 0 && (
                  <tr><td colSpan={labelSpan} className={`${cell} text-slate-500`}>Net Value</td><td className={cell}>{inr(summary.netValue)}</td></tr>
                )}
                <tr><td colSpan={labelSpan} className={`${cell} text-slate-500`}>Shipping Fee{summary.shipping === 0 ? ' (Free)' : ''}</td><td className={cell}>{inr(summary.shipping)}</td></tr>
                <tr><td colSpan={labelSpan} className={`${cell} text-slate-500`}>GST ({summary.gstRateLabel})</td><td className={cell}>{inr(summary.gstAmount)}</td></tr>
                {summary.roundOff !== 0 && (
                  <tr><td colSpan={labelSpan} className={`${cell} text-slate-500`}>Round Off</td><td className={cell}>{summary.roundOff > 0 ? '+ ' : '− '}{inr(Math.abs(summary.roundOff))}</td></tr>
                )}
                <tr><td colSpan={labelSpan} className="px-4 py-3 text-right font-semibold">Net Payable Amount</td><td className="px-4 py-3 text-right font-semibold text-brand">{inr(summary.netPayable)}</td></tr>
              </tfoot>
            </table>
          );
        })()}
      </div>

      {order.shippingAddress && (
        <div className="card p-4">
          <div className="label">Shipping address</div>
          <div className="text-sm whitespace-pre-line">{order.shippingAddress}</div>
        </div>
      )}

      <TrackingCard order={order} onSaved={load} />

      <ProfitCard order={order} onSaved={load} />

      <RefundCard order={order} onDone={load} />
      <CreditNoteCard orderId={order.id} />


      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="label">Customer notes</div>
          <div className="text-sm whitespace-pre-line">{order.notes || <span className="text-slate-400">None</span>}</div>
        </div>
        <div className="card p-4">
          <div className="label">Internal notes</div>
          <div className="text-sm whitespace-pre-line">{order.internalNotes || <span className="text-slate-400">None</span>}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Per-order Profit (internal, admin-only — never shown to the customer).
 * Same method as the Profit Calculator: revenue is GST-inclusive, GST paid on
 * cost is claimable ITC, so profit = revenue(ex-GST) − cost(ex-GST) − Razorpay
 * − internal shipping. Internal shipping + any missing product cost price can
 * be edited inline.
 */
function ProfitCard({ order, onSaved }: { order: Order; onSaved: () => void | Promise<void> }) {
  const num = (v: string | number | null | undefined) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  const [ship, setShip] = useState(String(order.internalShippingCost ?? 0));
  const [rzp, setRzp] = useState('2.36');
  const [savingShip, setSavingShip] = useState(false);
  const [costEdits, setCostEdits] = useState<Record<number, string>>({});
  const [savingCost, setSavingCost] = useState<number | null>(null);

  useEffect(() => { setShip(String(order.internalShippingCost ?? 0)); }, [order.internalShippingCost]);

  // Authoritative GST + total — same numbers as the items table / invoice.
  const summary = computeOrderSummary(
    order.items.map((it) => ({
      name: it.productName, sku: it.productSku, hsnCode: null,
      lineInclusive: Number(it.lineTotal), quantity: it.quantity, taxPercent: Number(it.taxPercent),
    })),
    Number(order.discountAmount ?? 0),
    Number(order.shippingCost ?? 0),
  );

  const totalAmount = Number(order.totalAmount ?? summary.netPayable);
  const gstCollected = summary.gstAmount;
  const revenueExGst = totalAmount - gstCollected;

  let costExGst = 0, costIncl = 0, itc = 0, anyMissing = false;
  for (const it of order.items) {
    const tax = Number(it.taxPercent ?? 18);
    const saved = it.product?.costPrice;
    const edited = costEdits[it.id];
    const cp = edited !== undefined && edited !== '' ? num(edited) : (saved != null ? Number(saved) : null);
    if (cp == null) { anyMissing = true; continue; }
    const base = cp * it.quantity;
    costExGst += base;
    itc += (base * tax) / 100;
    costIncl += base + (base * tax) / 100;
  }

  const razorpay = (totalAmount * num(rzp)) / 100;
  const netGst = gstCollected - itc;
  const internalShip = num(ship);
  const profit = revenueExGst - costExGst - razorpay - internalShip;
  const marginCost = costIncl > 0 ? (profit / costIncl) * 100 : 0;
  const marginSale = revenueExGst > 0 ? (profit / revenueExGst) * 100 : 0;

  async function saveShip() {
    setSavingShip(true);
    try {
      await api(`/api/orders/${order.id}`, { method: 'PATCH', body: JSON.stringify({ internalShippingCost: num(ship) }) });
      await onSaved();
    } finally { setSavingShip(false); }
  }
  async function saveCost(it: OrderItem) {
    const pid = it.product?.id ?? it.productId;
    if (!pid) return;
    setSavingCost(it.id);
    try {
      await api(`/api/products/${pid}`, { method: 'PATCH', body: JSON.stringify({ costPrice: num(costEdits[it.id]) }) });
      setCostEdits((m) => { const n = { ...m }; delete n[it.id]; return n; });
      await onSaved();
    } finally { setSavingCost(null); }
  }

  const R = ({ label, value, strong, muted, hint }: { label: string; value: number; strong?: boolean; muted?: boolean; hint?: string }) => (
    <div className={`flex items-center justify-between text-sm ${strong ? 'font-semibold text-slate-800 border-t border-slate-100 pt-1.5' : muted ? 'text-slate-400' : 'text-slate-600'}`}>
      <span>{label}{hint && <span className="text-[11px] text-slate-400 ml-1.5">{hint}</span>}</span>
      <span>{inr(value)}</span>
    </div>
  );

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="label">Profit <span className="text-xs font-normal text-slate-400">· internal only</span></div>
        <div className="text-xs text-slate-400">Not shown to the customer</div>
      </div>

      {anyMissing && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
          <div className="text-xs font-semibold text-amber-800">Some products have no cost price — enter it (ex-GST) to complete the profit:</div>
          {order.items.filter((it) => it.product?.costPrice == null).map((it) => (
            <div key={it.id} className="flex items-center gap-2">
              <span className="text-sm text-slate-600 flex-1 truncate">{it.productName} <span className="text-[11px] text-slate-400">×{it.quantity}</span></span>
              <input className="input !py-1 w-32" inputMode="decimal" placeholder="Cost ₹"
                value={costEdits[it.id] ?? ''} onChange={(e) => setCostEdits((m) => ({ ...m, [it.id]: e.target.value.replace(/[^0-9.]/g, '') }))} />
              <button type="button" className="btn-outline !py-1 !px-3 text-xs" disabled={savingCost === it.id || !costEdits[it.id]} onClick={() => saveCost(it)}>
                {savingCost === it.id ? '…' : 'Save'}
              </button>
            </div>
          ))}
          <div className="text-[11px] text-amber-600">Saves to the product's cost price (used across all its orders).</div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-5">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Internal shipping cost ₹ <span className="text-slate-400">(courier — not charged to customer)</span></label>
            <div className="flex gap-2">
              <input className="input" inputMode="decimal" value={ship} onChange={(e) => setShip(e.target.value.replace(/[^0-9.]/g, ''))} />
              <button type="button" className="btn-outline !px-4" disabled={savingShip || num(ship) === Number(order.internalShippingCost ?? 0)} onClick={saveShip}>
                {savingShip ? '…' : 'Save'}
              </button>
            </div>
            {Number(order.shippingCost ?? 0) > 0 && (
              <div className="text-[11px] text-slate-400 mt-1">Customer paid {inr(Number(order.shippingCost))} shipping (already counted in revenue).</div>
            )}
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Razorpay fee %</label>
            <input className="input" inputMode="decimal" value={rzp} onChange={(e) => setRzp(e.target.value.replace(/[^0-9.]/g, ''))} />
          </div>
        </div>

        <div className="space-y-1.5">
          <R label="Revenue (incl GST)" value={totalAmount} />
          <R label="− GST collected" value={gstCollected} muted />
          <R label="Revenue (ex-GST)" value={revenueExGst} strong />
          <R label="Cost (incl GST)" value={costIncl} />
          <R label="Razorpay fee" value={razorpay} muted />
          <R label="GST paid" value={netGst} muted hint="collected − ITC" />
          <R label="Internal shipping" value={internalShip} muted />
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-200">
            <span className="font-bold text-slate-700">Net Profit</span>
            <span className={`font-head text-xl font-extrabold ${profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{inr(profit)}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 text-[11px] text-slate-500">
            <span>Margin (on cost): <b className={profit >= 0 ? 'text-emerald-700' : 'text-red-600'}>{marginCost.toFixed(0)}%</b></span>
            <span>On sale: <b>{marginSale.toFixed(0)}%</b></span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Refunds card. Issues a Razorpay refund via the API (admin-only endpoint).
 * Shown only for a paid (completed) order; hidden once refunded. Full refund by
 * default, or enter an amount for a partial refund. Requires an explicit
 * confirm() — money movement is never one-click.
 */
function RefundCard({ order, onDone }: { order: Order; onDone: () => void | Promise<void> }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  if (order.paymentStatus === 'refunded') {
    return (
      <div className="card p-4">
        <div className="label">Refund</div>
        <div className="text-sm text-slate-600">This order is marked <span className="font-medium">refunded</span>. See internal notes for the refund reference.</div>
      </div>
    );
  }
  // Only a paid Razorpay order can be refunded via the API.
  if (order.paymentStatus !== 'completed') return null;

  const total = Number(order.totalAmount || 0);
  const amt = amount.trim() ? Number(amount) : null;
  const partial = amt != null && amt > 0 && amt < total;

  async function issueRefund() {
    setError(null);
    setResult(null);
    if (amt != null && (!(amt > 0) || amt > total)) {
      setError(`Enter an amount between ₹1 and ₹${total} (or leave blank for a full refund).`);
      return;
    }
    const label = amt != null ? `₹${amt}${partial ? ' (partial)' : ''}` : `₹${total} (full)`;
    if (!window.confirm(`Refund ${label} to ${order.customerName || 'the customer'} for order ${order.orderNumber}?\n\nThis moves money back via Razorpay and cannot be undone.`)) {
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ refundId: string; amount: number; partial: boolean }>(
        `/api/orders/${order.id}/refund`,
        { method: 'POST', body: JSON.stringify({ ...(amt != null ? { amount: amt } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) }) }
      );
      setResult(`Refunded ₹${r.amount}${r.partial ? ' (partial)' : ''} — ref ${r.refundId}`);
      setAmount('');
      setReason('');
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refund failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="label">Refund</div>
      <div className="text-xs text-slate-500">
        Refunds the customer via Razorpay. Leave the amount blank for a full refund of {inr(total)}, or enter a smaller amount for a partial refund.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Amount (₹) — blank = full</label>
          <input className="input" inputMode="decimal" placeholder={`Full: ${total}`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs text-slate-500 mb-1">Reason (optional)</label>
          <input className="input" placeholder="e.g. Item returned / cancelled" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
      {result && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">{result}</div>}
      <button type="button" className="btn-primary !bg-red-700 hover:!bg-red-800 disabled:opacity-60" onClick={issueRefund} disabled={busy}>
        {busy ? 'Processing refund…' : partial ? `Refund ₹${amt}` : 'Issue full refund'}
      </button>
    </div>
  );
}

/**
 * Shipping & Tracking card. Three editable fields (carrier, AWB,
 * tracking URL) + a Save button that PATCHes the order. The PATCH
 * route auto-stamps shippedAt/deliveredAt when orderStatus moves to
 * 'shipped' / 'delivered', so we don't expose those as inputs.
 */
function TrackingCard({ order, onSaved }: { order: Order; onSaved: () => void | Promise<void> }) {
  const [carrierName, setCarrierName] = useState(order.carrierName ?? '');
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber ?? '');
  const [trackingUrl, setTrackingUrl] = useState(order.trackingUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset locals if the underlying order reloads with different values
  useEffect(() => {
    setCarrierName(order.carrierName ?? '');
    setTrackingNumber(order.trackingNumber ?? '');
    setTrackingUrl(order.trackingUrl ?? '');
  }, [order.carrierName, order.trackingNumber, order.trackingUrl]);

  const dirty =
    (carrierName || '') !== (order.carrierName ?? '') ||
    (trackingNumber || '') !== (order.trackingNumber ?? '') ||
    (trackingUrl || '') !== (order.trackingUrl ?? '');

  // Whether the order already carries a saved tracking number. Drives the
  // button label ("Update tracking" vs "Save tracking") and keeps the button
  // usable on an already-shipped order — WITHOUT a permanent green state.
  const hasSavedTracking = !!(order.trackingNumber ?? '').trim();

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/orders/${order.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          carrierName: carrierName.trim() || null,
          trackingNumber: trackingNumber.trim() || null,
          trackingUrl: trackingUrl.trim() || null,
        }),
      });
      // Transient confirmation — green button + inline note + toast appear for
      // ~2.5s then revert. Fire immediately (don't gate on the reload, which
      // also sends the customer email and can be slow).
      setSaved(true);
      setToast(true);
      setTimeout(() => setSaved(false), 2500);
      setTimeout(() => setToast(false), 2500);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    {toast && (
      <div
        role="status"
        className="fixed top-4 right-4 z-[400] flex items-center gap-3 rounded-lg bg-emerald-600 text-white px-4 py-3 shadow-xl"
      >
        <span className="text-xl leading-none">✅</span>
        <div>
          <div className="font-semibold text-sm">Tracking saved</div>
          <div className="text-xs text-emerald-50">Order marked Shipped &amp; customer notified</div>
        </div>
      </div>
    )}
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="label">Shipping & tracking</div>
        {order.shippedAt && (
          <div className="text-xs text-slate-500">
            Shipped {dateShort(order.shippedAt)}
            {order.deliveredAt && ` · Delivered ${dateShort(order.deliveredAt)}`}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Carrier</label>
          <input
            className="input"
            placeholder="e.g. Shiprocket"
            value={carrierName}
            onChange={(e) => setCarrierName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Tracking / AWB number</label>
          <input
            className="input font-mono"
            placeholder="e.g. SR123456789"
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Tracking URL (optional)</label>
          <input
            className="input"
            placeholder="https://shiprocket.in/tracking/..."
            value={trackingUrl}
            onChange={(e) => setTrackingUrl(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          className={saved ? 'btn-primary !bg-emerald-600' : 'btn-primary'}
          onClick={save}
          disabled={saving || (!dirty && !hasSavedTracking)}
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : hasSavedTracking ? 'Update tracking' : 'Save tracking'}
        </button>
        {saved ? (
          <span className="text-sm text-emerald-600 font-medium">
            Saved — order marked Shipped &amp; customer notified ✅
          </span>
        ) : (
        <span className="text-xs text-slate-500">
          Customer sees this on /track and /account/orders/{order.orderNumber}.
        </span>
        )}
      </div>
    </div>
    </>
  );
}

/**
 * Credit notes for this order.
 *
 * A credit note reverses part or all of an invoiced sale. It does NOT edit the
 * original invoice — that invoice stays in the month it was filed — so the note
 * carries its own date, and that date decides which month's GSTR-1 it reduces.
 * The date defaults to today but is editable, because a return processed late
 * still belongs to the month the goods actually came back.
 */
function CreditNoteCard({ orderId }: { orderId: number }) {
  const [data, setData] = useState<any>(null);
  const [reason, setReason] = useState('Sales return');
  const [amount, setAmount] = useState('');
  const [issuedAt, setIssuedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    try { setData(await api<any>(`/api/credit-notes?orderId=${orderId}`)); } catch { /* panel just stays empty */ }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [orderId]);

  async function issue() {
    if (!confirm('Issue this credit note? It becomes a numbered tax document and cannot be edited afterwards.')) return;
    setBusy(true); setMsg(null);
    try {
      const res = await api<any>('/api/credit-notes', {
        method: 'POST',
        body: JSON.stringify({
          orderId,
          reason,
          notes: notes || null,
          amount: amount.trim() === '' ? null : Number(amount),
          issuedAt,
        }),
      });
      setMsg(`Issued ${res.creditNote.number}`);
      setAmount(''); setNotes('');
      await load();
    } catch (e: any) {
      setMsg(e?.message || 'Could not issue the credit note');
    } finally { setBusy(false); }
  }

  if (!data) return null;
  const p = data.preview || {};
  const blocked = !!p.error;

  return (
    <div className="card p-5 space-y-3">
      <h2 className="font-semibold text-slate-800">Credit notes</h2>

      {blocked ? (
        <p className="text-sm text-slate-500">{p.error}</p>
      ) : (
        <p className="text-xs text-slate-500">
          Against invoice <span className="font-mono">{p.invoiceNumber}</span> · invoice total{' '}
          {inr(p.totalAmount)} · already credited {inr(p.alreadyCredited)} ·{' '}
          <span className="font-medium text-slate-700">{inr(p.creditableRemaining)} still creditable</span>
        </p>
      )}

      {data.creditNotes?.length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left py-1">Number</th>
              <th className="text-left py-1">Issued</th>
              <th className="text-left py-1">Reason</th>
              <th className="text-right py-1">Taxable</th>
              <th className="text-right py-1">GST</th>
              <th className="text-right py-1">Total</th>
              <th className="text-right py-1"></th>
            </tr>
          </thead>
          <tbody>
            {data.creditNotes.map((n: any) => (
              <tr key={n.id} className="border-t border-slate-100">
                <td className="py-1 font-mono">{n.number}</td>
                <td className="py-1">{new Date(n.issuedAt).toLocaleDateString('en-IN')}</td>
                <td className="py-1">{n.reason}</td>
                <td className="py-1 text-right">{inr(Number(n.taxableValue))}</td>
                <td className="py-1 text-right">{inr(Number(n.cgst) + Number(n.sgst) + Number(n.igst))}</td>
                <td className="py-1 text-right font-medium">{inr(Number(n.totalAmount))}</td>
                <td className="py-1 text-right">
                  <a href={`/api/credit-notes/${n.id}/pdf`} target="_blank" rel="noopener"
                     className="text-brand hover:underline">PDF</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!blocked && p.creditableRemaining > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 pt-2 border-t border-slate-100">
          <label className="block">
            <span className="text-[11px] text-slate-500">Reason</span>
            <select className="input input-sm w-full" value={reason} onChange={(e) => setReason(e.target.value)}>
              {(data.reasons || []).map((r: string) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-500">Amount (blank = full)</span>
            <input className="input input-sm w-full text-right" placeholder={String(p.creditableRemaining)}
              value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-500">Issue date</span>
            <input type="date" className="input input-sm w-full" value={issuedAt}
              onChange={(e) => setIssuedAt(e.target.value)} />
            <span className="text-[10px] text-slate-400">Decides the GST month</span>
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-500">Note (optional)</span>
            <input className="input input-sm w-full" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="md:col-span-4">
            <button onClick={issue} disabled={busy} className="btn-primary text-sm disabled:opacity-50">
              {busy ? 'Issuing…' : 'Issue credit note'}
            </button>
            {msg && <span className="ml-3 text-xs text-slate-600">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
