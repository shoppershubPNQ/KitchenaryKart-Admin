'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, dateShort } from '@/lib/fetch';

interface Review {
  id: number;
  productSku: string;
  customerId: number | null;
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
  const [showSeed, setShowSeed] = useState(false);

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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Reviews</h1>
          <p className="text-sm text-slate-500 mt-1">
            Verified-buyer reviews from the storefront. Auto-approved by default.
            Unapprove or delete anything abusive — the PDP only shows approved reviews.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowSeed(true)}
          className="btn-primary"
        >
          + Seed demo review
        </button>
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

      {showSeed && (
        <SeedReviewModal
          onClose={() => setShowSeed(false)}
          onCreated={() => {
            setShowSeed(false);
            load();
          }}
        />
      )}

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
                    {r.customerId == null && (
                      <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 font-semibold uppercase tracking-wider">
                        Seeded
                      </span>
                    )}
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

/**
 * Seeded-review modal. Lets the admin post a fake / marketing review
 * directly, bypassing the storefront's verified-buyer check. customerId
 * is null on the resulting row (schema allows this) and the row is
 * tagged "Seeded" in the list above for moderation visibility.
 */
function SeedReviewModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [productSku, setProductSku] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [createdAt, setCreatedAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        productSku: productSku.trim().toUpperCase(),
        customerName: customerName.trim(),
        rating,
        body: body.trim(),
      };
      if (title.trim()) payload.title = title.trim();
      if (createdAt) payload.createdAt = new Date(createdAt).toISOString();
      await api('/api/reviews', { method: 'POST', body: JSON.stringify(payload) });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to seed review');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className="fixed inset-0 bg-black/50 z-[300]"
      />
      <div className="fixed inset-0 z-[301] grid place-items-center px-4 py-8 overflow-y-auto">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
          <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Seed a demo review</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Bypasses the verified-buyer check. Marked "Seeded" in the list.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 rounded-full grid place-items-center text-slate-400 hover:bg-slate-100 text-2xl"
            >
              ×
            </button>
          </div>

          <form onSubmit={submit} className="p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Product SKU</label>
                <input
                  className="input font-mono"
                  required
                  placeholder="KKHE0009-BMWG2"
                  value={productSku}
                  onChange={(e) => setProductSku(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Reviewer name</label>
                <input
                  className="input"
                  required
                  maxLength={80}
                  placeholder="e.g. Rajesh K."
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="label">Rating</label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    aria-label={`${n} stars`}
                    aria-pressed={rating === n}
                    className={`w-9 h-9 rounded grid place-items-center text-2xl transition ${
                      n <= rating ? 'text-yellow-500' : 'text-slate-200 hover:text-yellow-300'
                    }`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Title (optional)</label>
              <input
                className="input"
                maxLength={80}
                placeholder="e.g. Crisp every time"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div>
              <label className="label">Review body</label>
              <textarea
                className="input resize-y"
                required
                rows={4}
                minLength={10}
                maxLength={2000}
                placeholder="What did the buyer like? Min 10 characters."
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              <div className="text-[11px] text-slate-400 mt-1">{body.length}/2000</div>
            </div>

            <div>
              <label className="label">Created at (optional — backdate)</label>
              <input
                className="input"
                type="datetime-local"
                value={createdAt}
                onChange={(e) => setCreatedAt(e.target.value)}
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Leave blank to use the current time.
              </p>
            </div>

            {error && (
              <div className="rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !productSku || !customerName || body.length < 10}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? 'Posting…' : 'Post review'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
