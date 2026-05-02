'use client';

/**
 * Reusable banners table — used by both the "Banner 1" (hero carousel) and
 * "Banner 2" (secondary slot) admin pages. The placement scopes the list to
 * a single slot, and "+ New banner" creates the new row pre-tagged with that
 * placement so the lists never mix.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/fetch';

interface Banner {
  id: number;
  placement: string;
  position: number;
  isActive: boolean;
  imageUrl: string;
  alt: string | null;
  eyebrow: string | null;
  title: string | null;
  subtitle: string | null;
  ctaText: string | null;
  ctaHref: string | null;
  productSku: string | null;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

const WEB_BASE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001';
function bannerSrc(url: string): string {
  if (/^https?:/i.test(url)) return url;
  return WEB_BASE.replace(/\/$/, '') + url;
}

interface Props {
  /** "hero" → Banner 1 (HeroCarousel). "secondary" → Banner 2. */
  placement: 'hero' | 'secondary';
  heading: string;
  description: string;
}

export function BannersList({ placement, heading, description }: Props) {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await api<{ banners: Banner[] }>(
        `/api/banners?placement=${encodeURIComponent(placement)}`,
      );
      setBanners(data.banners);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placement]);

  async function toggleActive(b: Banner) {
    const next = !b.isActive;
    setBanners((prev) =>
      prev.map((x) => (x.id === b.id ? { ...x, isActive: next } : x)),
    );
    try {
      await api(`/api/banners/${b.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
    } catch {
      setBanners((prev) =>
        prev.map((x) => (x.id === b.id ? { ...x, isActive: !next } : x)),
      );
      alert('Could not update. Retry?');
    }
  }

  async function movePosition(id: number, delta: -1 | 1) {
    const idx = banners.findIndex((b) => b.id === id);
    const other = idx + delta;
    if (idx === -1 || other < 0 || other >= banners.length) return;
    const a = banners[idx];
    const b = banners[other];
    const ap = a.position;
    const bp = b.position;
    setBanners((prev) => {
      const copy = [...prev];
      copy[idx] = { ...a, position: bp };
      copy[other] = { ...b, position: ap };
      copy.sort((x, y) => x.position - y.position);
      return copy;
    });
    try {
      await Promise.all([
        api(`/api/banners/${a.id}`, { method: 'PATCH', body: JSON.stringify({ position: bp }) }),
        api(`/api/banners/${b.id}`, { method: 'PATCH', body: JSON.stringify({ position: ap }) }),
      ]);
    } catch {
      alert('Reorder failed. Refreshing…');
      load();
    }
  }

  async function remove(id: number) {
    if (!confirm('Delete this banner?')) return;
    await api(`/api/banners/${id}`, { method: 'DELETE' });
    load();
  }

  // Each placement gets its own URL namespace so the sidebar can match the
  // active section by pathname alone.
  const baseHref = placement === 'secondary' ? '/dashboard/banners-2' : '/dashboard/banners';
  const newHref = `${baseHref}/new`;
  const editHref = (id: number) => `${baseHref}/${id}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{heading}</h1>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
        <Link href={newHref} className="btn-primary">+ New banner</Link>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th></Th>
              <Th>Image</Th>
              <Th>Title</Th>
              <Th>CTA</Th>
              <Th>Position</Th>
              <Th>Active</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-400">Loading…</td>
              </tr>
            )}
            {!loading && banners.length === 0 && (
              <tr>
                <td colSpan={7} className="p-12 text-center text-slate-500">
                  No banners yet in this slot.{' '}
                  <Link href={newHref} className="text-brand font-semibold hover:underline">
                    Create the first one
                  </Link>
                  .
                </td>
              </tr>
            )}
            {banners.map((b, i) => (
              <tr key={b.id} className="hover:bg-slate-50">
                <td className="px-2 py-2 w-20">
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => movePosition(b.id, -1)}
                      disabled={i === 0}
                      className="text-xs text-slate-500 hover:text-brand disabled:opacity-30"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => movePosition(b.id, 1)}
                      disabled={i === banners.length - 1}
                      className="text-xs text-slate-500 hover:text-brand disabled:opacity-30"
                      title="Move down"
                    >
                      ↓
                    </button>
                  </div>
                </td>
                <td className="px-4 py-2">
                  <img
                    src={bannerSrc(b.imageUrl)}
                    alt=""
                    className="w-32 h-10 object-cover rounded bg-slate-100 border border-slate-200"
                  />
                </td>
                <td className="px-4 py-2">
                  <Link
                    href={editHref(b.id)}
                    className="font-medium text-slate-900 hover:text-brand"
                  >
                    {b.title || <em className="text-slate-400">Untitled</em>}
                  </Link>
                  {b.eyebrow && <div className="text-xs text-slate-500">{b.eyebrow}</div>}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {b.ctaText ? (
                    <>
                      <div>{b.ctaText}</div>
                      <div className="text-xs text-slate-500 truncate max-w-[240px]">
                        → {b.productSku
                          ? `SKU: ${b.productSku}`
                          : b.category
                          ? `cat: ${b.category}`
                          : b.ctaHref || '—'}
                      </div>
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-600">{b.position}</td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleActive(b)}
                    className={b.isActive ? 'pill-green' : 'pill-gray'}
                    title={b.isActive ? 'Active — click to hide' : 'Hidden — click to show'}
                  >
                    {b.isActive ? 'Active' : 'Hidden'}
                  </button>
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    href={editHref(b.id)}
                    className="text-xs text-brand hover:underline mr-3"
                  >
                    Edit
                  </Link>
                  <button onClick={() => remove(b.id)} className="text-xs text-red-600 hover:underline">
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
