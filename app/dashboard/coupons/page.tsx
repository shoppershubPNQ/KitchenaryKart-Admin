'use client';

import { useEffect, useState } from 'react';
import { api, inr, dateShort } from '@/lib/fetch';

interface Coupon {
  id: number;
  code: string;
  description: string | null;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  minOrderValue: number | null;
  maxDiscountAmount: number | null;
  usageLimit: number | null;
  usageCount: number;
  perCustomerLimit: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  _count?: { redemptions: number };
}

function discountLabel(c: Coupon): string {
  if (c.discountType === 'percent') {
    const cap = c.maxDiscountAmount ? ` (max ${inr(c.maxDiscountAmount)})` : '';
    return `${c.discountValue}% off${cap}`;
  }
  return `${inr(c.discountValue)} off`;
}

function statusOf(c: Coupon): { label: string; cls: string } {
  if (!c.isActive) return { label: 'Inactive', cls: 'pill-yellow' };
  const now = Date.now();
  if (c.startsAt && now < new Date(c.startsAt).getTime())
    return { label: 'Scheduled', cls: 'pill-blue' };
  if (c.expiresAt && now > new Date(c.expiresAt).getTime())
    return { label: 'Expired', cls: 'pill-yellow' };
  if (c.usageLimit != null && c.usageCount >= c.usageLimit)
    return { label: 'Used up', cls: 'pill-yellow' };
  return { label: 'Active', cls: 'pill-green' };
}

export default function CouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<Record<number, boolean>>({});

  async function load() {
    setLoading(true);
    try {
      const data = await api<{ coupons: Coupon[] }>('/api/coupons');
      setCoupons(data.coupons);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function toggleActive(c: Coupon) {
    setBusy((b) => ({ ...b, [c.id]: true }));
    try {
      await api(`/api/coupons/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !c.isActive }),
      });
      await load();
    } finally {
      setBusy((b) => ({ ...b, [c.id]: false }));
    }
  }

  async function remove(c: Coupon) {
    if (!confirm(`Delete coupon "${c.code}"? This can't be undone.`)) return;
    setBusy((b) => ({ ...b, [c.id]: true }));
    try {
      await api(`/api/coupons/${c.id}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy((b) => ({ ...b, [c.id]: false }));
    }
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Coupons</h1>
          <p className="text-sm text-slate-500 mt-1">
            Discount codes customers can apply at checkout. Usage is counted
            only after payment is confirmed — abandoned carts don't burn a
            redemption.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="btn-primary"
        >
          + New coupon
        </button>
      </div>

      {showForm && (
        <CouponForm
          coupon={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      <div className="card overflow-hidden">
        {loading && <div className="p-12 text-center text-slate-400">Loading…</div>}
        {!loading && coupons.length === 0 && (
          <div className="p-16 text-center">
            <div className="text-5xl mb-3">🎟️</div>
            <h3 className="text-ink font-bold mb-1">No coupons yet</h3>
            <p className="text-sm text-slate-500">
              Create your first code — e.g. WELCOME10 for 10% off the first order.
            </p>
          </div>
        )}
        {!loading && coupons.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Discount</th>
                <th className="px-4 py-3">Conditions</th>
                <th className="px-4 py-3">Used</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {coupons.map((c) => {
                const st = statusOf(c);
                const isBusy = !!busy[c.id];
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-mono font-bold text-ink">{c.code}</div>
                      {c.description && (
                        <div className="text-xs text-slate-400 mt-0.5">
                          {c.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-ink">
                      {discountLabel(c)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {c.minOrderValue ? <div>Min order {inr(c.minOrderValue)}</div> : null}
                      {c.perCustomerLimit ? (
                        <div>{c.perCustomerLimit}× per customer</div>
                      ) : null}
                      {c.expiresAt ? <div>Expires {dateShort(c.expiresAt)}</div> : null}
                      {!c.minOrderValue && !c.perCustomerLimit && !c.expiresAt ? (
                        <span className="text-slate-300">—</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {c.usageCount}
                      {c.usageLimit != null ? ` / ${c.usageLimit}` : ''}
                    </td>
                    <td className="px-4 py-3">
                      <span className={st.cls}>{st.label}</span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleActive(c)}
                        disabled={isBusy}
                        className="text-xs font-semibold text-slate-600 hover:text-brand px-2 py-1"
                      >
                        {c.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(c);
                          setShowForm(true);
                        }}
                        disabled={isBusy}
                        className="text-xs font-semibold text-brand hover:underline px-2 py-1"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(c)}
                        disabled={isBusy}
                        className="text-xs font-semibold text-red-600 hover:text-red-700 px-2 py-1"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function CouponForm({
  coupon,
  onClose,
  onSaved,
}: {
  coupon: Coupon | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!coupon;
  const [code, setCode] = useState(coupon?.code ?? '');
  const [description, setDescription] = useState(coupon?.description ?? '');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>(
    coupon?.discountType ?? 'percent',
  );
  const [discountValue, setDiscountValue] = useState(
    coupon ? String(coupon.discountValue) : '10',
  );
  const [minOrderValue, setMinOrderValue] = useState(
    coupon?.minOrderValue != null ? String(coupon.minOrderValue) : '',
  );
  const [maxDiscountAmount, setMaxDiscountAmount] = useState(
    coupon?.maxDiscountAmount != null ? String(coupon.maxDiscountAmount) : '',
  );
  const [usageLimit, setUsageLimit] = useState(
    coupon?.usageLimit != null ? String(coupon.usageLimit) : '',
  );
  const [perCustomerLimit, setPerCustomerLimit] = useState(
    coupon?.perCustomerLimit != null ? String(coupon.perCustomerLimit) : '',
  );
  const [expiresAt, setExpiresAt] = useState(
    coupon?.expiresAt ? coupon.expiresAt.slice(0, 16) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const num = (s: string) => (s.trim() === '' ? null : Number(s));
      const payload: Record<string, unknown> = {
        description: description.trim() || null,
        discountType,
        discountValue: Number(discountValue),
        minOrderValue: num(minOrderValue),
        maxDiscountAmount: discountType === 'percent' ? num(maxDiscountAmount) : null,
        usageLimit: num(usageLimit),
        perCustomerLimit: num(perCustomerLimit),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      };
      if (!isEdit) payload.code = code.trim().toUpperCase();

      await api(isEdit ? `/api/coupons/${coupon!.id}` : '/api/coupons', {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save coupon');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div onClick={onClose} aria-hidden className="fixed inset-0 bg-black/50 z-[300]" />
      <div className="fixed inset-0 z-[301] grid place-items-center px-4 py-8 overflow-y-auto">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
          <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900">
              {isEdit ? `Edit ${coupon!.code}` : 'New coupon'}
            </h2>
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
            {!isEdit && (
              <div>
                <label className="label">Coupon code</label>
                <input
                  className="input font-mono uppercase"
                  required
                  maxLength={40}
                  placeholder="WELCOME10"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
              </div>
            )}

            <div>
              <label className="label">Description (internal)</label>
              <input
                className="input"
                maxLength={200}
                placeholder="e.g. First-order welcome offer"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Discount type</label>
                <select
                  className="input"
                  value={discountType}
                  onChange={(e) =>
                    setDiscountType(e.target.value as 'percent' | 'fixed')
                  }
                >
                  <option value="percent">Percentage (%)</option>
                  <option value="fixed">Flat (₹)</option>
                </select>
              </div>
              <div>
                <label className="label">
                  {discountType === 'percent' ? 'Percent off' : 'Rupees off'}
                </label>
                <input
                  className="input"
                  type="number"
                  required
                  min={1}
                  max={discountType === 'percent' ? 100 : undefined}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Min order value (₹)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  placeholder="Optional"
                  value={minOrderValue}
                  onChange={(e) => setMinOrderValue(e.target.value)}
                />
              </div>
              {discountType === 'percent' && (
                <div>
                  <label className="label">Max discount cap (₹)</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    placeholder="Optional"
                    value={maxDiscountAmount}
                    onChange={(e) => setMaxDiscountAmount(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Total usage limit</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  placeholder="Unlimited"
                  value={usageLimit}
                  onChange={(e) => setUsageLimit(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Per-customer limit</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  placeholder="Unlimited"
                  value={perCustomerLimit}
                  onChange={(e) => setPerCustomerLimit(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="label">Expires at (optional)</label>
              <input
                className="input"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
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
                disabled={busy || (!isEdit && !code.trim()) || !discountValue}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create coupon'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
