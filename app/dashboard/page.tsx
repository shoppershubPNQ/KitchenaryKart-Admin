'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, inr, dateShort } from '@/lib/fetch';
import { SalesChart } from '@/components/SalesChart';

interface RecentOrder {
  id: number;
  orderNumber: string;
  customerName: string | null;
  totalAmount: number;
  orderStatus: string;
  paymentStatus: string;
  createdAt: string;
}

interface TopProduct {
  id: number;
  name: string;
  unitsSold: number;
  totalRevenue: number;
}

interface Stats {
  period: { key: string; label: string; range: string; compareLabel: string | null };
  totalOrders: number;
  totalRevenue: number;
  totalCustomers: number;
  totalProducts: number;
  todayOrders: number;
  todayRevenue: number;
  periodRevenue: number;
  prevPeriodRevenue: number;
  periodOrders: number;
  periodNewCustomers: number;
  periodAvgOrderValue: number;
  avgOrderValue: number;
  pendingOrders: number;
  toShipOrders: number;
  pendingPayments: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  newInquiries: number;
  activeCoupons: number;
  recentOrders: RecentOrder[];
  topProducts: TopProduct[];
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

/** Period options, mirroring lib/dashboard-period.ts. */
const PERIODS: Array<{ key: string; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'last-3-months', label: 'Last 3 months' },
  { key: 'this-year', label: 'This year' },
  { key: 'last-year', label: 'Last year' },
  { key: 'this-fy', label: 'This financial year' },
  { key: 'last-fy', label: 'Last financial year' },
  { key: 'all', label: 'All time' },
];

export default function DashboardHome() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [period, setPeriod] = useState('this-month');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    api<Stats>(`/api/analytics/dashboard?period=${period}`)
      // Guard against a slow earlier request landing after a newer one and
      // painting the wrong period's numbers.
      .then((d) => { if (!cancelled) setStats(d); })
      .catch((e) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  // Growth against the PRECEDING equivalent window (last month vs the month
  // before, last year vs the year before), so the comparison stays meaningful
  // whichever period is selected.
  const growth = stats && stats.prevPeriodRevenue > 0
    ? ((stats.periodRevenue - stats.prevPeriodRevenue) / stats.prevPeriodRevenue) * 100
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500">
            {stats ? `${stats.period.label} · ${stats.period.range}` : 'Snapshot of store health.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="input input-sm"
            aria-label="Reporting period"
          >
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
          {loading && <span className="text-xs text-slate-400">Loading…</span>}
          <Link href="/dashboard/analytics" className="text-sm text-brand hover:underline whitespace-nowrap">
            Full analytics →
          </Link>
        </div>
      </div>

      {err && <div className="card p-4 text-sm text-red-600">Couldn't load stats: {err}</div>}

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label={stats ? `Revenue · ${stats.period.label.toLowerCase()}` : 'Revenue'}
          value={stats ? inr(stats.periodRevenue) : '…'}
          accent="brand"
          hint={
            growth === null
              ? undefined
              : `${growth >= 0 ? '▲' : '▼'} ${Math.abs(growth).toFixed(1)}% ${stats?.period.compareLabel ?? ''}`
          }
          hintTone={growth === null ? undefined : growth >= 0 ? 'up' : 'down'}
        />
        <StatCard
          label="Orders (paid)"
          value={stats ? stats.periodOrders.toLocaleString() : '…'}
          accent="green"
          hint={stats ? `${inr(stats.totalRevenue)} all-time` : undefined}
        />
        <StatCard label="Today's revenue" value={stats ? inr(stats.todayRevenue) : '…'} accent="blue" hint={stats ? `${stats.todayOrders} order${stats.todayOrders === 1 ? '' : 's'} today` : undefined} />
        <StatCard
          label="Avg. order value"
          value={stats ? inr(stats.periodAvgOrderValue) : '…'}
          accent="slate"
          hint={stats ? `${inr(stats.avgOrderValue)} all-time` : undefined}
        />
      </div>

      {/* Action queues */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Pending orders" value={stats ? stats.pendingOrders.toLocaleString() : '…'} accent="yellow" href="/dashboard/orders?status=pending" />
        <StatCard label="Ready to ship" value={stats ? stats.toShipOrders.toLocaleString() : '…'} accent="blue" href="/dashboard/orders?status=processing" />
        <StatCard label="Payments pending" value={stats ? stats.pendingPayments.toLocaleString() : '…'} accent="yellow" href="/dashboard/orders?paymentStatus=pending" />
        <StatCard label="New inquiries" value={stats ? stats.newInquiries.toLocaleString() : '…'} accent="green" href="/dashboard/inquiries?status=new" />
        <StatCard label="Low-stock items" value={stats ? stats.lowStockProducts.toLocaleString() : '…'} accent="yellow" href="/dashboard/inventory" />
        <StatCard label="Out of stock" value={stats ? stats.outOfStockProducts.toLocaleString() : '…'} accent="red" href="/dashboard/inventory" />
        <StatCard label="Total orders" value={stats ? stats.totalOrders.toLocaleString() : '…'} accent="slate" href="/dashboard/orders" />
        <StatCard label="Active coupons" value={stats ? stats.activeCoupons.toLocaleString() : '…'} accent="slate" href="/dashboard/coupons" />
      </div>

      {/* Chart + catalog snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Sales · last 60 days</h2>
            <Link href="/dashboard/analytics" className="text-xs text-brand hover:underline">Details</Link>
          </div>
          <SalesChart />
        </div>
        <div className="space-y-4">
          <div className="card p-6">
            <h2 className="font-semibold mb-3">Catalog & customers</h2>
            <dl className="space-y-2 text-sm">
              <Row label="Products" value={stats ? stats.totalProducts.toLocaleString() : '…'} href="/dashboard/products" />
              <Row label="Customers" value={stats ? stats.totalCustomers.toLocaleString() : '…'} href="/dashboard/customers" />
              <Row label={stats ? `New customers (${stats.period.label.toLowerCase()})` : "New customers"} value={stats ? stats.periodNewCustomers.toLocaleString() : "…"} />
            </dl>
          </div>
          <div className="card p-6">
            <h2 className="font-semibold mb-3">Quick actions</h2>
            <ul className="space-y-2 text-sm">
              <li><Link className="text-brand hover:underline" href="/dashboard/products">+ Add product</Link></li>
              <li><Link className="text-brand hover:underline" href="/dashboard/orders">View orders</Link></li>
              <li><Link className="text-brand hover:underline" href="/dashboard/inquiries">Review inquiries</Link></li>
              <li><Link className="text-brand hover:underline" href="/dashboard/inventory">Low-stock alerts</Link></li>
              <li><Link className="text-brand hover:underline" href="/dashboard/analytics">Sales & top products</Link></li>
            </ul>
          </div>
        </div>
      </div>

      {/* Recent orders + top products */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Recent orders</h2>
            <Link href="/dashboard/orders" className="text-xs text-brand hover:underline">View all</Link>
          </div>
          {!stats ? (
            <div className="text-sm text-slate-400">Loading…</div>
          ) : stats.recentOrders.length === 0 ? (
            <div className="text-sm text-slate-400">No orders yet.</div>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-2 font-medium">Order</th>
                    <th className="px-2 py-2 font-medium">Customer</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 font-medium">Payment</th>
                    <th className="px-2 py-2 font-medium text-right">Total</th>
                    <th className="px-2 py-2 font-medium text-right">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stats.recentOrders.map(o => (
                    <tr key={o.id} className="hover:bg-slate-50">
                      <td className="px-2 py-2">
                        <Link href={`/dashboard/orders/${o.id}`} className="text-brand hover:underline font-medium">{o.orderNumber}</Link>
                      </td>
                      <td className="px-2 py-2 text-slate-700">{o.customerName || '—'}</td>
                      <td className="px-2 py-2"><span className={statusPill[o.orderStatus] || 'pill-gray'}>{o.orderStatus}</span></td>
                      <td className="px-2 py-2"><span className={statusPill[o.paymentStatus] || 'pill-gray'}>{o.paymentStatus}</span></td>
                      <td className="px-2 py-2 text-right font-medium">{inr(o.totalAmount)}</td>
                      <td className="px-2 py-2 text-right text-slate-500 whitespace-nowrap">{dateShort(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Top products{stats ? <span className="ml-2 text-xs font-normal text-slate-400">{stats.period.label.toLowerCase()}</span> : null}</h2>
            <Link href="/dashboard/analytics" className="text-xs text-brand hover:underline">All</Link>
          </div>
          {!stats ? (
            <div className="text-sm text-slate-400">Loading…</div>
          ) : stats.topProducts.length === 0 ? (
            <div className="text-sm text-slate-400">No sales yet.</div>
          ) : (
            <ol className="space-y-3">
              {stats.topProducts.map((p, i) => (
                <li key={p.id} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/products/${p.id}`} className="block truncate text-sm text-slate-800 hover:text-brand" title={p.name}>{p.name}</Link>
                    <div className="text-xs text-slate-500">{p.unitsSold.toLocaleString()} sold</div>
                  </div>
                  <div className="text-sm font-medium text-slate-900 whitespace-nowrap">{inr(p.totalRevenue)}</div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  const inner = (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
  return href ? <Link href={href} className="block hover:text-brand">{inner}</Link> : inner;
}

function StatCard({
  label,
  value,
  accent,
  href,
  hint,
  hintTone,
}: {
  label: string;
  value: string;
  accent: 'brand' | 'blue' | 'yellow' | 'red' | 'green' | 'slate';
  href?: string;
  hint?: string;
  hintTone?: 'up' | 'down';
}) {
  const ring = {
    brand: 'border-l-brand',
    blue: 'border-l-blue-500',
    yellow: 'border-l-yellow-500',
    red: 'border-l-red-500',
    green: 'border-l-green-500',
    slate: 'border-l-slate-400',
  }[accent];
  const hintColor = hintTone === 'up' ? 'text-green-600' : hintTone === 'down' ? 'text-red-600' : 'text-slate-400';
  const content = (
    <div className={`card p-4 border-l-4 ${ring} h-full`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {hint && <div className={`mt-1 text-xs ${hintColor}`}>{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block hover:shadow">{content}</Link> : content;
}
