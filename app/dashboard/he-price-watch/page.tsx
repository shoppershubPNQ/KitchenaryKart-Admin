'use client';

/**
 * HE price rises — every active size now priced below Hotelic Essentials'
 * price × 1.30 + GST. The list comes from the daily check (07:45 IST) or
 * "Check now"; our prices are re-read on every load, so a size raised from
 * the product page drops off straight away. Nothing here changes a price.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, dateShort, inrExact } from '@/lib/fetch';
import { HeRise, istDateTime, plural } from '@/lib/he-price-watch-shared';

interface WatchData {
  checked: boolean;
  checkedAt?: string;
  stale?: boolean;
  total: number;
  products?: number;
  gstDiffers?: number;
  examined?: number;
  truncated?: boolean;
  items: HeRise[];
}

export default function HePriceWatchPage() {
  const [data, setData] = useState<WatchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      setData(await api<WatchData>('/api/he-price-watch?full=1'));
    } catch (e: any) {
      setErr(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function checkNow() {
    setRunning(true);
    setErr(null);
    try {
      await api('/api/he-price-watch', { method: 'POST', body: JSON.stringify({ action: 'run' }) });
      await load();
    } catch (e: any) {
      setErr(e?.message || 'The check failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold text-slate-900">HE price rises</h1>
          <p className="mt-1 text-sm text-slate-500">
            Sizes where our price is now below the Hotelic Essentials price × 1.30 + GST. Checked every morning at
            7:45 am IST. Prices on the website are not changed — update them from the product page, or tell Claude.
          </p>
        </div>
        {/* A 403 on load would fail again on "Check now" too. */}
        <button
          type="button"
          className="btn-primary disabled:opacity-50"
          onClick={checkNow}
          disabled={running || loading || err === 'Forbidden'}
        >
          {running ? 'Checking… (about a minute)' : 'Check now'}
        </button>
      </div>

      {err && <div className="notice-red">{err}</div>}

      {loading && !data ? (
        <div className="card p-8 text-center text-slate-400">Loading…</div>
      ) : !data ? null /* the red notice above says why */ : !data.checked ? (
        <div className="card p-8 text-center text-slate-500">No check has run yet — click “Check now”.</div>
      ) : (
        <>
          {data.stale && (
            <div className="notice-amber">
              The daily HE price check has not worked since {istDateTime(data.checkedAt)}. Click “Check now”.
            </div>
          )}

          <div className="card flex flex-wrap gap-x-6 gap-y-1 px-4 py-3 text-sm text-slate-600">
            <span>
              Checked <span className="font-medium text-slate-900">{istDateTime(data.checkedAt)}</span>
            </span>
            <span>
              <span className="font-medium text-slate-900">{plural(data.total, 'size')}</span>
              {data.products != null && data.products !== data.total && <> ({plural(data.products, 'product')})</>} below
              the HE price
            </span>
            <span>{plural(data.examined ?? 0, 'size')} compared with HE</span>
            {!!data.gstDiffers && (
              <span title="HE's GST is not the same as ours, so the × 1.30 rule cannot be applied. Not counted as rises.">
                {plural(data.gstDiffers, 'size')} skipped — GST differs from HE
              </span>
            )}
          </div>

          {data.truncated && (
            <div className="notice-amber">Only the biggest rises are listed. Fix these and click “Check now” to see the rest.</div>
          )}

          {data.items.length === 0 ? (
            <div className="card p-8 text-center text-slate-500">
              No price rises — every size is at or above HE price × 1.30 + GST.
            </div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="table-mini">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Category</th>
                    <th>Size</th>
                    <th className="text-right">Our price</th>
                    <th className="text-right">HE price (incl. GST)</th>
                    <th className="text-right">New price (HE × 1.30 + GST)</th>
                    <th className="text-right">Increase</th>
                    <th>HE updated</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={`${r.productId}-${r.sku}`} className={r.big ? 'row-warn' : ''}>
                      <td className="min-w-[14rem]">
                        <Link href={`/dashboard/products/${r.productId}`} className="link">
                          {r.name}
                        </Link>
                        {r.isNew && <span className="pill-green ml-1">New</span>}
                        {r.big && (
                          <span className="block">
                            <span className="pill-yellow mt-1">Check with HE first</span>
                          </span>
                        )}
                      </td>
                      <td className="mono whitespace-nowrap text-slate-600">
                        {r.sku}
                        {r.listingSku !== r.sku && <span className="block text-slate-400">{r.listingSku}</span>}
                      </td>
                      <td className="text-xs text-slate-500">{r.category || '—'}</td>
                      <td className="text-slate-600">{r.size ?? '—'}</td>
                      <td className="whitespace-nowrap text-right text-slate-600">{inrExact(r.ours)}</td>
                      <td className="whitespace-nowrap text-right text-slate-600">
                        {inrExact(r.heIncl)}
                        <span className="block text-xs text-slate-400">GST {r.heTax}%</span>
                      </td>
                      <td className="whitespace-nowrap text-right font-medium text-slate-900">{inrExact(r.target)}</td>
                      <td className="whitespace-nowrap text-right font-medium text-red-700">
                        +{inrExact(r.diff)}
                        <span className="block text-xs font-normal text-slate-500">{r.pct == null ? '—' : `+${r.pct}%`}</span>
                      </td>
                      <td className="whitespace-nowrap text-xs text-slate-500">{dateShort(r.heUpdatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
