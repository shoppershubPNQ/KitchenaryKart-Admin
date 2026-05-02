'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, inr, dateShort } from '@/lib/fetch';

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
  shippingAddress: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  shippingCost: number | null;
  totalAmount: number | null;
  orderStatus: string;
  paymentStatus: string;
  paymentMethod: string | null;
  notes: string | null;
  internalNotes: string | null;
  createdAt: string;
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
        </div>
      </div>

      <div className="card">
        <div className="px-4 py-3 border-b border-slate-200 font-semibold">Items</div>
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 uppercase bg-slate-50">
            <tr>
              <th className="px-4 py-2 text-left">SKU</th>
              <th className="px-4 py-2 text-left">Name</th>
              <th className="px-4 py-2 text-right">Qty</th>
              <th className="px-4 py-2 text-right">Unit</th>
              <th className="px-4 py-2 text-right">GST%</th>
              <th className="px-4 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {order.items.map(it => (
              <tr key={it.id}>
                <td className="px-4 py-2 font-mono text-xs">{it.productSku}</td>
                <td className="px-4 py-2">{it.productName}</td>
                <td className="px-4 py-2 text-right">{it.quantity}</td>
                <td className="px-4 py-2 text-right">{inr(it.unitPrice)}</td>
                <td className="px-4 py-2 text-right">{Number(it.taxPercent)}</td>
                <td className="px-4 py-2 text-right font-medium">{inr(it.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 text-sm">
            <tr><td colSpan={5} className="px-4 py-2 text-right text-slate-500">Subtotal</td><td className="px-4 py-2 text-right">{inr(order.subtotal)}</td></tr>
            <tr><td colSpan={5} className="px-4 py-2 text-right text-slate-500">GST</td><td className="px-4 py-2 text-right">{inr(order.taxAmount)}</td></tr>
            <tr><td colSpan={5} className="px-4 py-2 text-right text-slate-500">Shipping</td><td className="px-4 py-2 text-right">{inr(order.shippingCost)}</td></tr>
            <tr><td colSpan={5} className="px-4 py-3 text-right font-semibold">Total</td><td className="px-4 py-3 text-right font-semibold text-brand">{inr(order.totalAmount)}</td></tr>
          </tfoot>
        </table>
      </div>

      {order.shippingAddress && (
        <div className="card p-4">
          <div className="label">Shipping address</div>
          <div className="text-sm whitespace-pre-line">{order.shippingAddress}</div>
        </div>
      )}

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
