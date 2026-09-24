'use client';

import { useEffect, useState } from 'react';
import { api, inr } from '@/lib/fetch';

/**
 * What shoppers said on their way out of checkout.
 *
 * Reasons are ranked by how often they were given, with the cart value that
 * left with them — because the most common answer and the most expensive one
 * are not always the same, and it is the second that decides what to fix
 * first.
 */

interface Reason {
  key: string;
  label: string;
  count: number;
  lostValue: number;
  share: number;
}
interface Row {
  id: string;
  reason: string;
  label: string;
  note: string | null;
  cartValue: number | null;
  itemCount: number | null;
  createdAt: string;
}
interface Data {
  days: number;
  total: number;
  /** Answers given while staff were testing the checkout, left out of the counts. */
  staffExcluded: number;
  lostValue: number;
  reasons: Reason[];
  recent: Row[];
}

const when = (s: string) =>
  new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function WhyLost({ days }: { days: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    api<Data>(`/api/analytics/checkout-feedback?days=${days}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [days]);

  if (error) return <div className="notice-red">{error}</div>;
  if (!data) return <div className="card p-8 text-center text-slate-400">Loading…</div>;

  if (data.total === 0) {
    return (
      <div className="card border-dashed p-10 text-center">
        <p className="font-medium text-slate-800">No answers yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
          The popup asks a shopper why they are leaving checkout without paying, once per visit. Answers
          appear here as they come in.
        </p>
      </div>
    );
  }

  const top = data.reasons[0];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <p className="kicker">Answers</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{data.total}</p>
          <p className="text-xs text-slate-400">
            in the last {data.days} days
            {data.staffExcluded > 0
              ? ` · ${data.staffExcluded} staff test${data.staffExcluded === 1 ? '' : 's'} excluded`
              : ''}
          </p>
        </div>
        <div className="card p-5">
          <p className="kicker">Cart value that left</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{inr(data.lostValue)}</p>
          <p className="text-xs text-slate-400">total of the carts behind these answers</p>
        </div>
        <div className="card p-5">
          <p className="kicker">Most common</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{top?.label ?? '—'}</p>
          <p className="text-xs text-slate-400">
            {top ? `${top.count} of ${data.total} · ${top.share}%` : ''}
          </p>
        </div>
      </div>

      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-200 px-5 py-3 font-semibold text-slate-900">Reasons given</h2>
        <table className="table-mini">
          <thead>
            <tr>
              <th>Reason</th>
              <th className="text-right">Answers</th>
              <th className="w-40">Share</th>
              <th className="text-right">Cart value lost</th>
            </tr>
          </thead>
          <tbody>
            {data.reasons.map((r) => (
              <tr key={r.key}>
                <td className="font-medium text-slate-900">{r.label}</td>
                <td className="text-right">{r.count}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 rounded bg-slate-100">
                      <div className="h-2 rounded bg-red-700" style={{ width: `${r.share}%` }} />
                    </div>
                    <span className="w-10 text-right text-xs text-slate-500">{r.share}%</span>
                  </div>
                </td>
                <td className="text-right text-slate-600">{inr(r.lostValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-200 px-5 py-3 font-semibold text-slate-900">
          Latest answers
        </h2>
        <table className="table-mini">
          <thead>
            <tr>
              <th>When</th>
              <th>Reason</th>
              <th>In their words</th>
              <th className="text-right">Cart</th>
            </tr>
          </thead>
          <tbody>
            {data.recent.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap text-slate-500">{when(r.createdAt)}</td>
                <td className="text-slate-900">{r.label}</td>
                <td className="text-slate-600">{r.note || <span className="text-slate-300">—</span>}</td>
                <td className="whitespace-nowrap text-right text-slate-600">
                  {r.cartValue === null ? '—' : inr(r.cartValue)}
                  {r.itemCount ? <span className="text-xs text-slate-400"> · {r.itemCount} item{r.itemCount === 1 ? '' : 's'}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
