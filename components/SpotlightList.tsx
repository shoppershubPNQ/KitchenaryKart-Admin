'use client';

/**
 * Featured Spotlight admin table. Each row = one rich single-product feature
 * that renders on the home teaser + the dedicated /featured/<slug> page.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/fetch';

interface Spotlight {
  id: number;
  slug: string;
  productSku: string;
  headline: string | null;
  videoUrl: string | null;
  position: number;
  isActive: boolean;
}

export function SpotlightList() {
  const [rows, setRows] = useState<Spotlight[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await api<{ spotlights: Spotlight[] }>('/api/spotlight');
      setRows(data.spotlights);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function toggleActive(s: Spotlight) {
    const next = !s.isActive;
    setRows((prev) => prev.map((x) => (x.id === s.id ? { ...x, isActive: next } : x)));
    try {
      await api(`/api/spotlight/${s.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: next }) });
    } catch {
      setRows((prev) => prev.map((x) => (x.id === s.id ? { ...x, isActive: !next } : x)));
      alert('Could not update. Retry?');
    }
  }

  async function remove(id: number) {
    if (!confirm('Delete this spotlight? The featured page + home teaser will stop showing it.')) return;
    await api(`/api/spotlight/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Featured Spotlight</h1>
          <p className="text-sm text-slate-500">
            A rich single-product feature shown on the home page and its own <code>/featured/&lt;slug&gt;</code> page.
            Price &amp; stock stay live from the linked product.
          </p>
        </div>
        <Link href="/dashboard/spotlight/new" className="btn-primary">+ New spotlight</Link>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th>Headline / slug</Th>
              <Th>Product SKU</Th>
              <Th>Video</Th>
              <Th>Order</Th>
              <Th>Active</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (<tr><td colSpan={6} className="p-8 text-center text-slate-400">Loading…</td></tr>)}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="p-12 text-center text-slate-500">
                No spotlights yet. <Link href="/dashboard/spotlight/new" className="text-brand font-semibold hover:underline">Create the first one</Link>.
              </td></tr>
            )}
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link href={`/dashboard/spotlight/${s.id}`} className="font-medium text-slate-900 hover:text-brand">
                    {s.headline || <em className="text-slate-400">Uses product name</em>}
                  </Link>
                  <div className="text-xs text-slate-500">/featured/{s.slug}</div>
                </td>
                <td className="px-4 py-2"><code className="text-xs">{s.productSku}</code></td>
                <td className="px-4 py-2 text-slate-600">{s.videoUrl ? '🎬 Yes' : <span className="text-slate-400">—</span>}</td>
                <td className="px-4 py-2 text-slate-600">{s.position}</td>
                <td className="px-4 py-2">
                  <button type="button" onClick={() => toggleActive(s)} className={s.isActive ? 'pill-green' : 'pill-gray'}>
                    {s.isActive ? 'Active' : 'Hidden'}
                  </button>
                </td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/dashboard/spotlight/${s.id}`} className="text-xs text-brand hover:underline mr-3">Edit</Link>
                  <button onClick={() => remove(s.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-4 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide text-left">{children}</th>;
}
