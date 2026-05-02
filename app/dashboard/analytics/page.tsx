'use client';

import { useEffect, useState } from 'react';
import { api, inr } from '@/lib/fetch';
import { SalesChart } from '@/components/SalesChart';

interface TopProduct { id: number; sku: string; name: string; category: string | null; unitsSold: number; totalRevenue: number; ordersCount: number }

export default function AnalyticsPage() {
  const [products, setProducts] = useState<TopProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ products: TopProduct[] }>('/api/analytics/top-products').then(d => setProducts(d.products)).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="text-2xl font-semibold text-slate-900">Analytics</h1>

      <section className="card p-6">
        <h2 className="font-semibold mb-3">Sales trend · last 60 days</h2>
        <SalesChart />
      </section>

      <section className="card">
        <div className="px-4 py-3 border-b border-slate-200 font-semibold">Top products by revenue</div>
        {loading && <div className="p-8 text-center text-slate-400">Loading…</div>}
        {!loading && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">SKU</th>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Category</th>
                <th className="px-4 py-2 text-right">Orders</th>
                <th className="px-4 py-2 text-right">Units</th>
                <th className="px-4 py-2 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map(p => (
                <tr key={p.id}>
                  <td className="px-4 py-2 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-2">{p.name}</td>
                  <td className="px-4 py-2 text-slate-600">{p.category || '—'}</td>
                  <td className="px-4 py-2 text-right">{p.ordersCount}</td>
                  <td className="px-4 py-2 text-right">{p.unitsSold}</td>
                  <td className="px-4 py-2 text-right font-medium">{inr(p.totalRevenue)}</td>
                </tr>
              ))}
              {products.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-400">No sales data yet.</td></tr>}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
