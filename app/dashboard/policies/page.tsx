'use client';

/**
 * Policies list page. Auto-seeds the five standard policies on first load
 * (Privacy, Terms, Shipping, Pricing, Cancellation). Each row links to
 * /dashboard/policies/<slug> for editing the title and body.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/fetch';

interface Policy {
  slug: string;
  title: string;
  body: string;
  isActive: boolean;
  position: number;
  updatedAt: string;
}

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ policies: Policy[] }>('/api/policies');
      setPolicies(data.policies);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(p: Policy) {
    const next = !p.isActive;
    setPolicies((prev) =>
      prev.map((x) => (x.slug === p.slug ? { ...x, isActive: next } : x)),
    );
    try {
      await api(`/api/policies/${p.slug}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
    } catch {
      setPolicies((prev) =>
        prev.map((x) => (x.slug === p.slug ? { ...x, isActive: !next } : x)),
      );
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Policies</h1>
        <p className="text-sm text-slate-500">
          Edit the policy pages shown in the storefront footer. Each page is
          available at <code>/policy/&lt;slug&gt;</code> on the public site.
        </p>
      </div>

      {error && (
        <div className="card p-4 text-sm text-red-600 bg-red-50 border border-red-200">
          {error}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th>Title</Th>
              <Th>Slug</Th>
              <Th align="right">Body length</Th>
              <Th>Active</Th>
              <Th>Last updated</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400">Loading…</td>
              </tr>
            )}
            {!loading && policies.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400">No policies.</td>
              </tr>
            )}
            {policies.map((p) => (
              <tr key={p.slug} className="hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link
                    href={`/dashboard/policies/${p.slug}`}
                    className="font-medium text-slate-900 hover:text-brand"
                  >
                    {p.title}
                  </Link>
                </td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">/{p.slug}</td>
                <td className="px-4 py-2 text-right text-slate-500">
                  {p.body.length.toLocaleString('en-IN')} chars
                </td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleActive(p)}
                    className={p.isActive ? 'pill-green' : 'pill-gray'}
                    title={p.isActive ? 'Active — click to hide' : 'Hidden — click to show'}
                  >
                    {p.isActive ? 'Active' : 'Hidden'}
                  </button>
                </td>
                <td className="px-4 py-2 text-slate-500 text-xs">
                  {new Date(p.updatedAt).toLocaleString('en-IN')}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    href={`/dashboard/policies/${p.slug}`}
                    className="text-xs text-brand hover:underline"
                  >
                    Edit →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className={`px-4 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide text-${align}`}
    >
      {children}
    </th>
  );
}
