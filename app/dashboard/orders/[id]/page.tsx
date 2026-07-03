'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, inr, dateShort } from '@/lib/fetch';
import { computeOrderSummary } from '@/lib/order-summary';

interface OrderItem {
  id: number;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  taxPercent: number;
  lineTotal: number;
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

      <RefundCard order={order} onDone={load} />


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
