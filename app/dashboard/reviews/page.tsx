'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, dateShort } from '@/lib/fetch';

interface Review {
  id: number;
  productSku: string;
  customerId: number;
  customerName: string;
  rating: number;
  title: string | null;
  body: string;
  isApproved: boolean;
  createdAt: string;
  customer: { email: string; phone: string | null } | null;
  product: { name: string } | null;
}

type Filter = 'all' | 'approved' | 'unapproved';

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<number, boolean>>({});

  async function load() {
    setLoading(true);
    try {
      const data = await api<{ reviews: Review[] }>(`/api/reviews?status=${filter}`);
      setReviews(data.reviews);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  async function setApproved(id: number, isApproved: boolean) {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await api(`/api/reviews/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isApproved }),
      });
      await load();
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  async function remove(id: number) {
    if (!confirm('Permanently delete this review?')) return;
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await api(`/api/reviews/${id}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  const counts = {
    approved: reviews.filter((r) => r.isApproved).length,
    unapproved: reviews.filter((r) => !r.isApproved).length,
  };

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Reviews</h1>
          <p className="text-sm text-slate-500 mt-1">
            Verified-buyer reviews from the storefront. Auto-approved by default.
            Unapprove or delete anything abusive — the PDP only shows approved reviews.
          </p>
        </div>
      </div>

      <div className="card p-3 flex items-center gap-2">
        {(['all', 'approved', 'unapproved'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded text-sm font-semibold transition ${
              filter === f
                ? 'bg-brand text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {f === 'all'
              ? `All (${reviews.length})`
              : f === 'approved'
                ? `Approved (${counts.approved})`
                : `Unapproved (${counts.unapproved})`}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {loading && (
          <div className="p-8 text-center text-slate-400">Loading…</div>
        )}
        {!loading && reviews.length === 0 && (
          <div className="p-12 text-center text-slate-400">
            No reviews match this filter.
          </div>
        )}
        {!loading && reviews.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {reviews.map((r) => (
              <li key={r.id} className="p-5">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-yellow-500 text-lg">
                        {'★'.repeat(r.rating)}
                        <span className="text-slate-200">{'★'.repeat(5 - r.rating)}</span>
                      </span>
                      {r.isApproved ? (
                        <span className="pill-green">Approved</span>
                      ) : (
                        <span className="pill-yellow">Unapproved</span>
                      )}
                    </div>
                    {r.title && (
                      <div className="font-semibold text-slate-900 mt-2">
                        {r.title}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 text-right shrink-0">
                    {dateShort(r.createdAt)}
                  </div>
                </div>

                <p className="text-sm text-slate-700 whitespace-pre-line mb-3">
                  {r.body}
                </p>

                <div className="text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1 mb-3">
                  <span>
                    <strong className="text-slate-700">{r.customerName}</strong>
                    {r.customer?.email && ` · ${r.customer.email}`}
                    {r.customer?.phone && ` · ${r.customer.phone}`}
                  </span>
                  <span>
                    Product:{' '}
                    <Link
                      href={`https://kitchenarykart.com/product/${encodeURIComponent(r.productSku)}#reviews`}
                      target="_blank"
                      rel="noopener"
                      className="font-mono text-brand hover:underline"
                    >
                      {r.productSku}
                    </Link>
                    {r.product?.name && ` · ${r.product.name}`}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {r.isApproved ? (
                    <button
                      type="button"
                      onClick={() => setApproved(r.id, false)}
                      disabled={busy[r.id]}
                      className="btn-outline btn-small"
                    >
                      Unapprove
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setApproved(r.id, true)}
                      disabled={busy[r.id]}
                      className="btn-primary btn-small"
                    >
                      Approve
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(r.id)}
                    disabled={busy[r.id]}
                    className="text-sm font-semibold text-red-600 hover:text-red-700 px-2 py-1"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
