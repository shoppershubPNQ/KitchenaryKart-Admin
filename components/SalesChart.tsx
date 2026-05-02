'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api, inr } from '@/lib/fetch';

interface Point { date: string; revenue: number; orders: number }

export function SalesChart() {
  const [data, setData] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ data: Point[] }>('/api/analytics/sales-chart?period=month')
      .then(d => setData(d.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="h-72 flex items-center justify-center text-slate-400 text-sm">Loading…</div>;
  if (!data.length) return <div className="h-72 flex items-center justify-center text-slate-400 text-sm">No orders yet.</div>;

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data.map(d => ({ ...d, label: new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) }))}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" fontSize={12} stroke="#94a3b8" />
          <YAxis fontSize={12} stroke="#94a3b8" tickFormatter={(v) => '₹' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)} />
          <Tooltip formatter={(v: number) => inr(v)} />
          <Line type="monotone" dataKey="revenue" stroke="#a01818" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
