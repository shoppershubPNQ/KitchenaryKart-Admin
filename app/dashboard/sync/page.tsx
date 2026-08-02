'use client';

/**
 * Sync — both halves of the KitchenaryKart ↔ Hotelic Essentials link.
 *
 *   Publish  what we expose over /api/sync/* and the keys that open it.
 *   Import   what the partner exposes, reviewed here before anything is written.
 *
 * Listings imported from the partner are withheld from our own feed, so a
 * product cannot bounce between the two panels forever.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, dateShort, inr } from '@/lib/fetch';

type Tab = 'publish' | 'import';

export default function SyncPage() {
  const [tab, setTab] = useState<Tab>('publish');

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Sync</h1>
        <p className="mt-1 text-sm text-slate-500">
          Share the catalogue with Hotelic Essentials in both directions. Matching is always by
          SKU, so a product already in either system is recognised instead of duplicated.
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {(
          [
            ['publish', 'Publish to partners'],
            ['import', 'Import from Hotelic Essentials'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-brand text-brand'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'publish' ? <PublishPanel /> : <ImportPanel />}
    </div>
  );
}

/* ======================================================== PUBLISH (outbound) */

interface SyncKey {
  id: number;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  last_used_ip: string | null;
  request_count: number;
  active: boolean;
}

function timeAgo(value: string | null): string {
  if (!value) return 'never';
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} d ago`;
  return dateShort(value);
}

function PublishPanel() {
  const [keys, setKeys] = useState<SyncKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [issued, setIssued] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const syncBaseUrl = useMemo(() => (origin ? `${origin}/api/sync` : ''), [origin]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setKeys((await api<{ keys: SyncKey[] }>('/api/sync/keys')).keys);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  function copy(value: string, label: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 2000);
    });
  }

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const data = await api<{ key: string }>('/api/sync/keys', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      setIssued(data.key);
      setName('');
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function revoke(key: SyncKey) {
    if (!confirm(`Revoke "${key.name}"?\n\nAny panel using it stops syncing immediately.`)) return;
    try {
      await api(`/api/sync/keys/${key.id}`, { method: 'DELETE' });
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="space-y-5">
      {err && <ErrorBar message={err} />}

      <div className="card p-6 space-y-3">
        <h2 className="font-semibold text-slate-900">Step 1 — the sync URL</h2>
        <p className="text-sm text-slate-500">
          Paste this into the partner panel. It is derived from the domain you are on, so it is
          already correct for this deployment.
        </p>
        <div className="flex items-center gap-2">
          <input className="input font-mono text-sm" readOnly value={syncBaseUrl} />
          <button type="button" className="btn-outline whitespace-nowrap" onClick={() => copy(syncBaseUrl, 'url')}>
            {copied === 'url' ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="card p-6 space-y-4">
        <h2 className="font-semibold text-slate-900">Step 2 — issue an API key</h2>
        <form onSubmit={issue} className="flex flex-col gap-2 sm:flex-row">
          <input
            className="input"
            placeholder="e.g. Hotelic Essentials — production"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
          />
          <button className="btn-primary whitespace-nowrap" type="submit">
            Issue key
          </button>
        </form>

        {issued && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <div className="text-sm font-medium text-amber-900">
              Copy this key now — it cannot be shown again.
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input className="input bg-white font-mono text-sm" readOnly value={issued} />
              <button type="button" className="btn-outline whitespace-nowrap" onClick={() => copy(issued, 'key')}>
                {copied === 'key' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="font-semibold text-slate-900">Issued keys</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Name</th>
              <th className="px-4 py-2 text-left">Key</th>
              <th className="px-4 py-2 text-left">Pulls</th>
              <th className="px-4 py-2 text-left">Last used</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && keys.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-400">
                  No keys yet.
                </td>
              </tr>
            )}
            {keys.map((k) => (
              <tr key={k.id} className={k.active ? '' : 'opacity-50'}>
                <td className="px-4 py-2 font-medium">{k.name}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{k.key_prefix}…</td>
                <td className="px-4 py-2">{k.request_count}</td>
                <td className="px-4 py-2 text-slate-500">{timeAgo(k.last_used_at)}</td>
                <td className="px-4 py-2 text-right">
                  {k.active && (
                    <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => revoke(k)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ========================================================= IMPORT (inbound) */

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

function ImportPanel() {
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

  const pending = counts.new + counts.matched + counts.changed;

  if (!conn) return <div className="card p-8 text-center text-slate-400">Loading…</div>;

  return (
    <div className="space-y-5">
      {err && <ErrorBar message={err} />}
      {note && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {note}
        </div>
      )}

      <ConnectionCard conn={conn} onChanged={loadConn} />

      {!conn.configured ? (
        <div className="card border-dashed p-10 text-center">
          <p className="font-medium text-slate-800">Not connected yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Add the Hotelic Essentials sync URL and API key above. Both are shown in that panel
            under Catalogue Sync.
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
                  run('import', () =>
                    api('/api/sync/import', {
                      method: 'POST',
                      body: JSON.stringify({ all: true, updatePrice, updateStock, updateImages }),
                    }),
                  );
                }}
                disabled={busy !== null}
              >
                {busy === 'import' ? 'Importing…' : `Import all pending (${pending})`}
              </button>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <span className="font-medium text-slate-500">On update, also replace:</span>
              <Check label="Price" checked={updatePrice} onChange={setUpdatePrice} />
              <Check label="Stock" checked={updateStock} onChange={setUpdateStock} />
              <Check label="Images" checked={updateImages} onChange={setUpdateImages} />
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
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    tab === t.key ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
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
                <button
                  type="button"
                  className="btn-primary text-xs"
                  onClick={() =>
                    run('import', () =>
                      api('/api/sync/import', {
                        method: 'POST',
                        body: JSON.stringify({ skus: selected, updatePrice, updateStock, updateImages }),
                      }),
                    )
                  }
                  disabled={busy !== null}
                >
                  Import {selected.length}
                </button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={rows.length > 0 && rows.every((r) => selected.includes(r.sku))}
                        onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.sku) : [])}
                        aria-label="Select all"
                      />
                    </th>
                    <th className="px-3 py-2 text-left">Listing</th>
                    <th className="px-3 py-2 text-left">SKU</th>
                    <th className="px-3 py-2 text-left">Here</th>
                    <th className="px-3 py-2 text-left">State</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400">
                        Nothing in this state. Run a scan if you have not yet.
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.sku} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.includes(r.sku)}
                          onChange={() =>
                            setSelected((s) =>
                              s.includes(r.sku) ? s.filter((x) => x !== r.sku) : [...s, r.sku],
                            )
                          }
                          aria-label={`Select ${r.sku}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium text-slate-900">{r.remote_name ?? '—'}</span>
                        {r.last_error && <p className="text-xs text-red-600">{r.last_error}</p>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">{r.sku}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {r.product ? (
                          <>
                            <div className="truncate">{r.product.name}</div>
                            <div className="text-xs text-slate-400">
                              {inr(r.product.price)} · {r.product.stock} in stock
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-400">Not here</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={PILL[r.status]}>{LABEL[r.status]}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2 text-xs">
                          <button type="button" className="text-brand hover:underline" onClick={() => setDiffSku(r.sku)}>
                            Compare
                          </button>
                          <button
                            type="button"
                            className="text-brand hover:underline"
                            onClick={() =>
                              run('import', () =>
                                api('/api/sync/import', {
                                  method: 'POST',
                                  body: JSON.stringify({ skus: [r.sku], updatePrice, updateStock, updateImages }),
                                }),
                              )
                            }
                            disabled={busy !== null}
                          >
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

function ConnectionCard({ conn, onChanged }: { conn: any; onChanged: () => void }) {
  const [baseUrl, setBaseUrl] = useState(conn.base_url ?? '');
  const [apiKey, setApiKey] = useState('');
  const [open, setOpen] = useState(!conn.configured);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await api<any>('/api/sync/connection', {
        method: 'PUT',
        body: JSON.stringify({ baseUrl, apiKey }),
      });
      setTest(res.test);
      setApiKey('');
      onChanged();
    } catch (e: any) {
      setTest({ ok: false, message: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Hotelic Essentials connection</h2>
          {conn.configured ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <span className="pill-green">Connected</span>
              <span className="font-mono text-xs">{conn.base_url}</span>
              <span className="text-xs text-slate-400">key {conn.api_key_masked}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-500">
              Paste the sync URL and API key from the Hotelic Essentials admin.
            </p>
          )}
        </div>
        {conn.configured && (
          <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : 'Change'}
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Sync URL</label>
              <input
                className="input"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.hotelicessentials.com/api/v1/partner/sync"
              />
            </div>
            <div>
              <label className="label">API key</label>
              <input
                className="input"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={conn.configured ? 'Leave blank to keep the current key' : 'he_live_…'}
              />
            </div>
          </div>

          {test && (
            <div
              className={`rounded-md px-3 py-2 text-sm ${
                test.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
              }`}
            >
              {test.message}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={save} disabled={busy || !baseUrl.trim()}>
              {busy ? 'Saving…' : 'Save connection'}
            </button>
            <button
              type="button"
              className="btn-outline"
              disabled={busy || !baseUrl.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  setTest(
                    await api('/api/sync/connection/test', {
                      method: 'POST',
                      body: JSON.stringify({ baseUrl, apiKey }),
                    }),
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Test connection
            </button>
            {conn.configured && (
              <button
                type="button"
                className="text-sm text-red-600 hover:underline"
                onClick={async () => {
                  if (!confirm('Disconnect? Imported products and history are kept.')) return;
                  await api('/api/sync/connection', { method: 'DELETE' });
                  onChanged();
                }}
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DiffModal({ sku, onClose }: { sku: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<any>(`/api/sync/diff/${encodeURIComponent(sku)}`)
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [sku]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="mt-10 w-full max-w-3xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="font-semibold text-slate-900">Compare — {sku}</h3>
          <button type="button" className="text-slate-400 hover:text-slate-700" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="p-5">
          {err && <ErrorBar message={err} />}
          {!data && !err && <p className="text-center text-slate-400">Loading…</p>}
          {data && (
            <>
              <p className="mb-3 text-sm text-slate-500">
                {data.exists_here
                  ? `${data.changed_fields} field(s) differ. Importing replaces "Here" with "Hotelic Essentials".`
                  : 'Not in this catalogue yet — importing creates it with these values.'}
              </p>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Field</th>
                    <th className="px-3 py-2 text-left">Here</th>
                    <th className="px-3 py-2 text-left">Hotelic Essentials</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.fields.map((f: any) => (
                    <tr key={f.field} className={f.differs ? 'bg-amber-50' : ''}>
                      <td className="px-3 py-1.5 font-medium text-slate-700">
                        {f.label}
                        {f.note && <span className="block text-xs font-normal text-slate-400">{f.note}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-slate-500">{f.ours ?? '—'}</td>
                      <td className={`px-3 py-1.5 ${f.differs ? 'font-medium text-slate-900' : 'text-slate-500'}`}>
                        {f.theirs ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ bits */

function ErrorBar({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
