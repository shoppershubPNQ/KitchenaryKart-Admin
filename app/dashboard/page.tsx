'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, inr } from '@/lib/fetch';
import { SalesChart } from '@/components/SalesChart';

interface Stats {
  totalOrders: number;
  totalRevenue: number;
  pendingOrders: number;
  lowStockProducts: number;
  totalCustomers: number;
  totalProducts: number;
  newInquiries: number;
}

export default function DashboardHome() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<Stats>('/api/analytics/dashboard').then(setStats).catch(e => setErr(e.message));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Overview</h1>
        <p className="text-sm text-slate-500">Snapshot of store health.</p>
      </div>

      {err && <div className="card p-4 text-sm text-red-600">Couldn't load stats: {err}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Revenue (delivered)" value={stats ? inr(stats.totalRevenue) : '…'} accent="brand" />
        <StatCard label="Total orders" value={stats ? stats.totalOrders.toLocaleString() : '…'} accent="blue" />
        <StatCard label="Pending orders" value={stats ? stats.pendingOrders.toLocaleString() : '…'} accent="yellow" href="/dashboard/orders?status=pending" />
        <StatCard label="Low-stock items" value={stats ? stats.lowStockProducts.toLocaleString() : '…'} accent="red" href="/dashboard/inventory" />
        <StatCard label="Products" value={stats ? stats.totalProducts.toLocaleString() : '…'} accent="slate" href="/dashboard/products" />
        <StatCard label="Customers" value={stats ? stats.totalCustomers.toLocaleString() : '…'} accent="slate" href="/dashboard/customers" />
        <StatCard label="New inquiries" value={stats ? stats.newInquiries.toLocaleString() : '…'} accent="green" href="/dashboard/inquiries?status=new" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Sales · last 60 days</h2>
          </div>
          <SalesChart />
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
  );
}

function StatCard({ label, value, accent, href }: { label: string; value: string; accent: 'brand' | 'blue' | 'yellow' | 'red' | 'green' | 'slate'; href?: string }) {
  const ring = {
    brand: 'border-l-brand',
    blue: 'border-l-blue-500',
    yellow: 'border-l-yellow-500',
    red: 'border-l-red-500',
    green: 'border-l-green-500',
    slate: 'border-l-slate-400',
  }[accent];
  const content = (
    <div className={`card p-4 border-l-4 ${ring}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
  return href ? <Link href={href} className="block hover:shadow">{content}</Link> : content;
}
