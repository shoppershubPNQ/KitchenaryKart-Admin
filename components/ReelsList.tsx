'use client';

/**
 * Reels admin table. Each row shows a small video poster, the caption,
 * linked product SKU, position, active toggle and edit/delete actions.
 *
 * The storefront pulls the same data via /api/public/reels and renders
 * the first 4 active reels in the home page Watch & Shop section.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/fetch';

interface Reel {
  id: number;
  videoUrl: string;
  thumbnailUrl: string | null;
  caption: string | null;
  instagramUrl: string | null;
  productSku: string | null;
  viewCount: number;
  position: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function ReelsList() {
  const [reels, setReels] = useState<Reel[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await api<{ reels: Reel[] }>('/api/reels');
      setReels(data.reels);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(r: Reel) {
    const next = !r.isActive;
    setReels((prev) =>
      prev.map((x) => (x.id === r.id ? { ...x, isActive: next } : x)),
    );
    try {
      await api(`/api/reels/${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
    } catch {
      setReels((prev) =>
        prev.map((x) => (x.id === r.id ? { ...x, isActive: !next } : x)),
      );
      alert('Could not update. Retry?');
    }
  }

  async function movePosition(id: number, delta: -1 | 1) {
    const idx = reels.findIndex((b) => b.id === id);
    const other = idx + delta;
    if (idx === -1 || other < 0 || other >= reels.length) return;
    const a = reels[idx];
    const b = reels[other];
    const ap = a.position;
    const bp = b.position;
    setReels((prev) => {
      const copy = [...prev];
      copy[idx] = { ...a, position: bp };
      copy[other] = { ...b, position: ap };
      copy.sort((x, y) => x.position - y.position);
      return copy;
    });
    try {
      await Promise.all([
        api(`/api/reels/${a.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ position: bp }),
        }),
        api(`/api/reels/${b.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ position: ap }),
        }),
      ]);
    } catch {
      alert('Reorder failed. Refreshing…');
      load();
    }
  }

  async function remove(id: number) {
    if (!confirm('Delete this reel? The video stays in Cloudinary but is removed from the storefront.')) return;
    await api(`/api/reels/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Reels</h1>
          <p className="text-sm text-slate-500">
            Short product-demo videos shown in the storefront <em>Watch &amp; Shop</em> section.
            The first 4 active reels (by position) appear on the home page.
          </p>
        </div>
        <Link href="/dashboard/reels/new" className="btn-primary">
          + New reel
        </Link>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th></Th>
              <Th>Preview</Th>
              <Th>Caption</Th>
              <Th>Linked product</Th>
              <Th>Views</Th>
              <Th>Position</Th>
              <Th>Active</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-slate-400">Loading…</td>
              </tr>
            )}
            {!loading && reels.length === 0 && (
              <tr>
                <td colSpan={8} className="p-12 text-center text-slate-500">
                  No reels yet.{' '}
                  <Link href="/dashboard/reels/new" className="text-brand font-semibold hover:underline">
                    Upload your first one
                  </Link>
                  .
                </td>
              </tr>
            )}
            {reels.map((r, i) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-2 py-2 w-20">
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => movePosition(r.id, -1)}
                      disabled={i === 0}
                      className="text-xs text-slate-500 hover:text-brand disabled:opacity-30"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => movePosition(r.id, 1)}
                      disabled={i === reels.length - 1}
                      className="text-xs text-slate-500 hover:text-brand disabled:opacity-30"
                      title="Move down"
                    >
                      ↓
                    </button>
                  </div>
                </td>
                <td className="px-4 py-2">
                  {r.thumbnailUrl ? (
                    <img
                      src={r.thumbnailUrl}
                      alt=""
                      className="w-14 h-24 object-cover rounded bg-slate-100 border border-slate-200"
                    />
                  ) : (
                    <video
                      src={r.videoUrl}
                      muted
                      playsInline
                      className="w-14 h-24 object-cover rounded bg-slate-100 border border-slate-200"
                    />
                  )}
                </td>
                <td className="px-4 py-2 max-w-md">
                  <Link
                    href={`/dashboard/reels/${r.id}`}
                    className="font-medium text-slate-900 hover:text-brand line-clamp-2"
                  >
                    {r.caption || <em className="text-slate-400">Untitled reel</em>}
                  </Link>
                  {r.instagramUrl && (
                    <a
                      href={r.instagramUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-slate-500 hover:text-brand"
                    >
                      View on Instagram ↗
                    </a>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {r.productSku ? (
                    <code className="text-xs">{r.productSku}</code>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {r.viewCount > 0 ? r.viewCount.toLocaleString('en-IN') : <span className="text-slate-400">auto</span>}
                </td>
                <td className="px-4 py-2 text-slate-600">{r.position}</td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleActive(r)}
                    className={r.isActive ? 'pill-green' : 'pill-gray'}
                    title={r.isActive ? 'Active — click to hide' : 'Hidden — click to show'}
                  >
                    {r.isActive ? 'Active' : 'Hidden'}
                  </button>
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    href={`/dashboard/reels/${r.id}`}
                    className="text-xs text-brand hover:underline mr-3"
                  >
                    Edit
                  </Link>
                  <button onClick={() => remove(r.id)} className="text-xs text-red-600 hover:underline">
                    Delete
                  </button>
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
  return (
    <th className="px-4 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide text-left">
      {children}
    </th>
  );
}
