'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, inr } from '@/lib/fetch';
import { Check, ErrorBar, NoteBar } from './bits';
import ConnectionCard from './ConnectionCard';
import DiffModal from './DiffModal';
import PricingCard from './PricingCard';

/**
 * The inbound half: what Hotelic Essentials publishes, reviewed here before
 * anything is written. Scan refreshes the queue; each import button sends
 * the same set of "what an update may replace" ticks.
 */

type ItemStatus = 'new' | 'matched' | 'changed' | 'in_sync' | 'ignored' | 'missing';

interface ReviewRow {
  sku: string;
  remote_name: string | null;
  status: ItemStatus;
  product: { id: number; name: string; price: number; stock: number; image: string | null } | null;
  ignored: boolean;
  last_error: string | null;
}

const TABS: { key: ItemStatus | 'all'; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'matched', label: 'Matched' },
  { key: 'changed', label: 'Changed' },
  { key: 'in_sync', label: 'In sync' },
  { key: 'ignored', label: 'Ignored' },
  { key: 'missing', label: 'Unpublished' },
  { key: 'all', label: 'All' },
];

const PILL: Record<ItemStatus, string> = {
  new: 'pill-blue',
  matched: 'pill-yellow',
  changed: 'pill-yellow',
  in_sync: 'pill-green',
  ignored: 'pill-gray',
  missing: 'pill-red',
};

const LABEL: Record<ItemStatus, string> = {
  new: 'New',
  matched: 'Matched by SKU',
  changed: 'Changed upstream',
  in_sync: 'In sync',
  ignored: 'Ignored',
  missing: 'Unpublished',
};

export default function ImportPanel() {
  const [conn, setConn] = useState<any>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [counts, setCounts] = useState<Record<ItemStatus, number>>({
    new: 0, matched: 0, changed: 0, in_sync: 0, ignored: 0, missing: 0,
  });
  const [tab, setTab] = useState<ItemStatus | 'all'>('new');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [diffSku, setDiffSku] = useState<string | null>(null);

  const [updatePrice, setUpdatePrice] = useState(true);
  const [updateStock, setUpdateStock] = useState(true);
  const [updateImages, setUpdateImages] = useState(true);
  const [updateDetails, setUpdateDetails] = useState(true);
  const [updateStatus, setUpdateStatus] = useState(true);
  /** What an update may replace here — one set, sent by every import button. */
  const fields = { updatePrice, updateStock, updateImages, updateDetails, updateStatus };

  const loadConn = useCallback(async () => {
    try {
      setConn(await api<any>('/api/sync/connection'));
    } catch (e: any) {
      setErr(e.message);
    }
  }, []);

  const loadRows = useCallback(async () => {
    try {
      const data = await api<any>(`/api/sync/review?status=${tab}&limit=100`);
      setRows(data.items);
      setCounts(data.counts);
    } catch (e: any) {
      setErr(e.message);
    }
  }, [tab]);

  useEffect(() => {
    loadConn();
  }, [loadConn]);
  useEffect(() => {
    if (conn?.configured) loadRows();
  }, [conn?.configured, loadRows]);

  async function run(label: string, fn: () => Promise<any>) {
    setBusy(label);
    setErr(null);
    setNote(null);
    try {
      const res = await fn();
      if (res?.message) setNote(res.message);
      setSelected([]);
      await Promise.all([loadConn(), loadRows()]);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  const importSkus = (skus: string[] | 'all') =>
    run('import', () =>
      api('/api/sync/import', {
        method: 'POST',
        body: JSON.stringify(skus === 'all' ? { all: true, ...fields } : { skus, ...fields }),
      }),
    );

  const pending = counts.new + counts.matched + counts.changed;

  if (!conn) return <div className="card p-8 text-center text-slate-400">Loading…</div>;

  return (
    <div className="space-y-5">
      {err && <ErrorBar message={err} />}
      {note && <NoteBar message={note} />}

      <ConnectionCard conn={conn} onChanged={loadConn} />

      {conn.configured && <PricingCard />}

      {!conn.configured ? (
        <div className="card border-dashed p-10 text-center">
          <p className="font-medium text-slate-800">Not connected yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Add the Hotelic Essentials sync URL and API key above. Both are shown in that panel under Catalogue Sync.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-outline"
              onClick={() => run('scan', () => api('/api/sync/scan', { method: 'POST' }))}
              disabled={busy !== null}
            >
              {busy === 'scan' ? 'Scanning…' : 'Scan for changes'}
            </button>
            {pending > 0 && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  if (!confirm(`Import all ${pending} pending listing(s)?`)) return;
                  importSkus('all');
                }}
                disabled={busy !== null}
              >
                {busy === 'import' ? 'Importing…' : `Import all pending (${pending})`}
              </button>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <span className="font-medium text-slate-500">On update, replace:</span>
              <Check label="Price" checked={updatePrice} onChange={setUpdatePrice} />
              <Check label="Stock" checked={updateStock} onChange={setUpdateStock} />
              <Check label="Images" checked={updateImages} onChange={setUpdateImages} />
              <Check label="Details (name, description, HSN, GST, specs)" checked={updateDetails} onChange={setUpdateDetails} />
              <Check label="Status" checked={updateStatus} onChange={setUpdateStatus} />
              <span className="text-slate-400">SKU renames always come across.</span>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="flex flex-wrap gap-1 border-b border-slate-200 p-2">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTab(t.key);
                    setSelected([]);
                  }}
                  className={`tab-pill ${tab === t.key ? 'tab-pill-active' : ''}`}
                >
                  {t.label}
                  {t.key !== 'all' && (
                    <span className={`ml-1.5 text-xs ${tab === t.key ? 'text-white/80' : 'text-slate-400'}`}>
                      {counts[t.key as ItemStatus]}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {selected.length > 0 && (
              <div className="flex items-center justify-between bg-blue-50 px-4 py-2 text-sm">
                <span className="font-medium text-blue-900">{selected.length} selected</span>
                <button type="button" className="btn-primary text-xs" onClick={() => importSkus(selected)} disabled={busy !== null}>
                  Import {selected.length}
                </button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="table-mini">
                <thead>
                  <tr>
                    <th className="w-10">
                      <input
                        type="checkbox"
                        checked={rows.length > 0 && rows.every((r) => selected.includes(r.sku))}
                        onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.sku) : [])}
                        aria-label="Select all"
                      />
                    </th>
                    <th>Listing</th>
                    <th>SKU</th>
                    <th>Here</th>
                    <th>State</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400">
                        Nothing in this state. Run a scan if you have not yet.
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.sku} className="hover:bg-slate-50">
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.includes(r.sku)}
                          onChange={() =>
                            setSelected((s) => (s.includes(r.sku) ? s.filter((x) => x !== r.sku) : [...s, r.sku]))
                          }
                          aria-label={`Select ${r.sku}`}
                        />
                      </td>
                      <td>
                        <span className="font-medium text-slate-900">{r.remote_name ?? '—'}</span>
                        {r.last_error && <p className="text-xs text-red-600">{r.last_error}</p>}
                      </td>
                      <td className="mono text-slate-500">{r.sku}</td>
                      <td className="text-slate-600">
                        {r.product ? (
                          <div className="flex items-center gap-2">
                            {r.product.image && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={r.product.image} alt="" loading="lazy" className="thumb-sm" />
                            )}
                            <div>
                              <div className="truncate">{r.product.name}</div>
                              <div className="text-xs text-slate-400">
                                {inr(r.product.price)} · {r.product.stock} in stock
                              </div>
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">Not here</span>
                        )}
                      </td>
                      <td>
                        <span className={PILL[r.status]}>{LABEL[r.status]}</span>
                      </td>
                      <td>
                        <div className="flex justify-end gap-2 text-xs">
                          <button type="button" className="link" onClick={() => setDiffSku(r.sku)}>
                            Compare
                          </button>
                          <button type="button" className="link" onClick={() => importSkus([r.sku])} disabled={busy !== null}>
                            {r.product ? 'Update' : 'Import'}
                          </button>
                          <button
                            type="button"
                            className="text-slate-500 hover:underline"
                            onClick={() =>
                              run('ignore', () =>
                                api(`/api/sync/ignore/${encodeURIComponent(r.sku)}`, {
                                  method: 'PUT',
                                  body: JSON.stringify({ ignored: !r.ignored }),
                                }),
                              )
                            }
                          >
                            {r.ignored ? 'Restore' : 'Ignore'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {diffSku && <DiffModal sku={diffSku} onClose={() => setDiffSku(null)} />}
    </div>
  );
}
