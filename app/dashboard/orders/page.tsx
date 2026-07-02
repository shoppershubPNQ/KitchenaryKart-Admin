'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, inr, dateShort } from '@/lib/fetch';

interface Order {
  id: number;
  orderNumber: string;
  customerName: string | null;
  customerEmail: string | null;
  totalAmount: number | null;
  orderStatus: string;
  paymentStatus: string;
  createdAt: string;
}

const statusPill: Record<string, string> = {
  pending: 'pill-yellow',
  processing: 'pill-blue',
  shipped: 'pill-blue',
  delivered: 'pill-green',
  cancelled: 'pill-gray',
  completed: 'pill-green',
  failed: 'pill-red',
  refunded: 'pill-gray',
};

function OrdersList() {
  const params = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(params.get('status') || '');
  const [search, setSearch] = useState('');
  const [reconciling, setReconciling] = useState(false);

  // Reconcile pending orders against Razorpay: a UPI payment can be captured
  // by Razorpay while the customer's browser never returned to confirm it,
  // leaving the order stuck "pending". This asks the server to check each
  // pending order against Razorpay and mark the genuinely-paid ones paid
  // (failed/abandoned attempts are left untouched).
  async function reconcile() {
    if (reconciling) return;
    setReconciling(true);
    try {
      const r = await api<{ reconciledCount: number; checked: number; stillPending: string[] }>(
        '/api/orders/reconcile',
        { method: 'POST' }
      );
      alert(
        `Checked ${r.checked} pending order(s).\n` +
          `Marked paid: ${r.reconciledCount}.\n` +
          `Still pending (unpaid/failed): ${r.stillPending.length}.`
      );
      await load();
    } catch (e) {
      alert('Reconcile failed: ' + (e instanceof Error ? e.message : 'unknown error'));
    } finally {
      setReconciling(false);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (status) q.set('status', status);
      if (search) q.set('search', search);
      const data = await api<{ orders: Order[] }>('/api/orders?' + q);
      setOrders(data.orders);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Orders</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reconcile}
            disabled={reconciling}
            title="Check pending orders against Razorpay and mark genuinely-paid ones as paid"
            className="btn-secondary disabled:opacity-60"
          >
            {reconciling ? 'Reconciling…' : '↻ Reconcile payments'}
          </button>
          <Link href="/dashboard/orders/new" className="btn-primary">+ Manual order</Link>
        </div>
      </div>

      <div className="card p-4 flex flex-wrap gap-3">
        <input className="input max-w-xs" placeholder="Search # / name / email" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input max-w-xs" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th>Order #</Th><Th>Customer</Th><Th>Date</Th>
              <Th align="right">Total</Th><Th>Order</Th><Th>Payment</Th><Th> </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={7} className="p-8 text-center text-slate-400">Loading…</td></tr>}
            {!loading && orders.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-400">No orders yet.</td></tr>}
            {orders.map(o => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-mono text-xs">
                  <Link href={`/dashboard/orders/${o.id}`} className="text-brand hover:underline">{o.orderNumber}</Link>
                </td>
                <td className="px-4 py-2">
                  <div className="font-medium">{o.customerName || '—'}</div>
                  <div className="text-xs text-slate-500">{o.customerEmail || ''}</div>
                </td>
                <td className="px-4 py-2 text-slate-600">{dateShort(o.createdAt)}</td>
                <td className="px-4 py-2 text-right font-medium">{inr(o.totalAmount)}</td>
                <td className="px-4 py-2"><span className={statusPill[o.orderStatus] || 'pill-gray'}>{o.orderStatus}</span></td>
                <td className="px-4 py-2"><span className={statusPill[o.paymentStatus] || 'pill-gray'}>{o.paymentStatus}</span></td>
                <td className="px-4 py-2 text-right">
                  <a href={`/api/orders/${o.id}/invoice`} target="_blank" rel="noopener" className="text-xs text-slate-600 hover:text-brand">Invoice ↗</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function OrdersPage() {
  return <Suspense fallback={<div className="p-6 text-slate-400">Loading…</div>}><OrdersList /></Suspense>;
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`px-4 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide text-${align}`}>{children}</th>;
}
