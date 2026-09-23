'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, inr } from '@/lib/fetch';
import { Check, ErrorBar, NoteBar, timeAgo } from './bits';
import ConnectionCard from './ConnectionCard';
import DiffModal from './DiffModal';
import PricingCard from './PricingCard';

/**
 * The inbound half: what Hotelic Essentials publishes, reviewed here before
 * anything is written. Scan refreshes the queue; each import button sends the
 * same set of "what an update may replace" ticks.
 *
 * The table shows what the operator needs to judge a listing WITHOUT opening
 * it — cover image, the partner's shelf, their price and what it becomes here,
 * stock, how many images and variants come with it. Deciding 400 listings one
 * modal at a time is not a decision, it is a chore, and chores get skipped.
 */

type ItemStatus = 'new' | 'matched' | 'changed' | 'in_sync' | 'ignored' | 'missing';

interface ReviewRow {
  sku: string;
  remote_name: string | null;
  status: ItemStatus;
  remote: {
    price: number | null;
    mrp: number | null;
    landed_price: number | null;
    stock: number | null;
    status: string | null;
    image: string | null;
    image_count: number | null;
    variant_count: number | null;
    category_path: string[];
  };
  product: { id: number; name: string; price: number; stock: number; image: string | null } | null;
  ignored: boolean;
  last_error: string | null;
}

const TABS: { key: ItemStatus | 'all'; label: string; hint: string }[] = [
  { key: 'new', label: 'New', hint: 'In their catalogue, not here yet' },
  { key: 'matched', label: 'Matched', hint: 'Same SKU here, never synced' },
  { key: 'changed', label: 'Changed', hint: 'Changed on their side since we imported' },
  { key: 'in_sync', label: 'In sync', hint: 'Nothing to do' },
  { key: 'ignored', label: 'Skipped', hint: 'Dismissed — will not come back' },
  { key: 'missing', label: 'Unpublished', hint: 'They stopped publishing it' },
  { key: 'all', label: 'All', hint: 'Every listing we know of' },
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
  ignored: 'Skipped',
  missing: 'Unpublished',
};

const PAGE = 50;

export default function ImportPanel() {
  const [conn, setConn] = useState<any>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [cats, setCats] = useState<{ name: string; count: number }[]>([]);
  const [counts, setCounts] = useState<Record<ItemStatus, number>>({
    new: 0, matched: 0, changed: 0, in_sync: 0, ignored: 0, missing: 0,
  });
  const [ourCats, setOurCats] = useState<string[]>([]);

  const [tab, setTab] = useState<ItemStatus | 'all'>('new');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(0);

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
  const [fieldsOpen, setFieldsOpen] = useState(false);

  /** Where new products land. Blank = match the partner's own shelf to ours. */
  const [fileInto, setFileInto] = useState('');

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
      const q = new URLSearchParams({
        status: tab,
        limit: String(PAGE),
        offset: String(page * PAGE),
      });
      if (search.trim()) q.set('search', search.trim());
      if (category) q.set('category', category);
      const data = await api<any>(`/api/sync/review?${q}`);
      setRows(data.items);
      setTotal(data.total);
      setCounts(data.counts);
      setCats(data.categories ?? []);
    } catch (e: any) {
      setErr(e.message);
    }
  }, [tab, page, search, category]);

  useEffect(() => {
    loadConn();
    // Only top-level shelves: a product is filed under a category, and the
    // subcategory is matched from the partner's own path when it exists here.
    api<any>('/api/categories')
      .then((d) =>
        setOurCats(
          (d?.categories ?? [])
            .filter((c: any) => c && c.parentId === null && c.name)
            .map((c: any) => c.name as string),
        ),
      )
      .catch(() => setOurCats([]));
  }, [loadConn]);

  useEffect(() => {
    if (conn?.configured) loadRows();
  }, [conn?.configured, loadRows]);

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setPage(0), 300);
    return () => clearTimeout(t);
  }, [search]);

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
        body: JSON.stringify({
          ...(skus === 'all' ? { all: true } : { skus }),
          ...fields,
          ...(fileInto ? { category: fileInto } : {}),
        }),
      }),
    );

  const setIgnored = (skus: string[], ignored: boolean) =>
    run('ignore', async () => {
      for (const sku of skus) {
        await api(`/api/sync/ignore/${encodeURIComponent(sku)}`, {
          method: 'PUT',
          body: JSON.stringify({ ignored }),
        });
      }
      return { message: `${skus.length} listing(s) ${ignored ? 'skipped' : 'restored'}.` };
    });

  const pending = counts.new + counts.matched + counts.changed;
  const pageRows = rows;
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.includes(r.sku));
  const lastScan = conn?.last_run?.finishedAt ?? conn?.last_run?.startedAt ?? null;

  const activeTab = useMemo(() => TABS.find((t) => t.key === tab), [tab]);

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
            Add the Hotelic Essentials sync URL and API key above. Both are shown in that panel under
            Catalogue Sync.
          </p>
        </div>
      ) : (
        <>
          {/* ---------------------------------------------------- toolbar */}
          <div className="card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-outline"
                onClick={() => run('scan', () => api('/api/sync/scan', { method: 'POST' }))}
                disabled={busy !== null}
              >
                {busy === 'scan' ? 'Scanning…' : 'Scan for changes'}
              </button>
              <span className="text-xs text-slate-500">
                Last scan {timeAgo(lastScan)}
                {conn.known_listings ? ` · ${conn.known_listings} listings known` : ''}
              </span>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <input
                  className="input-sm w-56"
                  placeholder="Search name or SKU…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select
                  className="input-sm"
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">Their category — all</option>
                  {cats.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} ({c.count})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* What an update may replace, and where new products land. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
              <label className="flex items-center gap-1.5">
                <span className="font-medium text-slate-500">File new products into</span>
                <select
                  className="input-sm"
                  value={fileInto}
                  onChange={(e) => setFileInto(e.target.value)}
                >
                  <option value="">Match their category (recommended)</option>
                  {ourCats.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className="link"
                onClick={() => setFieldsOpen((v) => !v)}
                aria-expanded={fieldsOpen}
              >
                {fieldsOpen ? 'Hide' : 'On update, replace…'}
              </button>

              {fieldsOpen && (
                <div className="flex flex-wrap items-center gap-3">
                  <Check label="Price" checked={updatePrice} onChange={setUpdatePrice} />
                  <Check label="Stock" checked={updateStock} onChange={setUpdateStock} />
                  <Check label="Images" checked={updateImages} onChange={setUpdateImages} />
                  <Check
                    label="Details (name, description, HSN, GST, specs)"
                    checked={updateDetails}
                    onChange={setUpdateDetails}
                  />
                  <Check label="Status" checked={updateStatus} onChange={setUpdateStatus} />
                  <span className="text-slate-400">
                    A new product always takes every field. SKU renames always come across.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ------------------------------------------------------ table */}
          <div className="card overflow-hidden">
            <div className="flex flex-wrap gap-1 border-b border-slate-200 p-2">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  title={t.hint}
                  onClick={() => {
                    setTab(t.key);
                    setSelected([]);
                    setPage(0);
                  }}
                  className={`tab-pill ${tab === t.key ? 'tab-pill-active' : ''}`}
                >
                  {t.label}
                  {t.key !== 'all' && (
                    <span
                      className={`ml-1.5 text-xs ${tab === t.key ? 'text-white/80' : 'text-slate-400'}`}
                    >
                      {counts[t.key as ItemStatus]}
                    </span>
                  )}
                </button>
              ))}
              {pending > 0 && (
                <button
                  type="button"
                  className="btn-primary ml-auto text-xs"
                  onClick={() => {
                    if (!confirm(`Import all ${pending} pending listing(s)?`)) return;
                    importSkus('all');
                  }}
                  disabled={busy !== null}
                >
                  {busy === 'import' ? 'Importing…' : `Import all pending (${pending})`}
                </button>
              )}
            </div>

            {activeTab && (
              <p className="border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-xs text-slate-500">
                {activeTab.hint}
                {total > 0 && ` · ${total} listing${total === 1 ? '' : 's'}`}
                {category && ` in ${category}`}
              </p>
            )}

            {selected.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 bg-blue-50 px-4 py-2 text-sm">
                <span className="font-medium text-blue-900">{selected.length} selected</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-xs text-slate-600 hover:underline"
                    onClick={() => setIgnored(selected, true)}
                    disabled={busy !== null}
                  >
                    Skip these
                  </button>
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    onClick={() => importSkus(selected)}
                    disabled={busy !== null}
                  >
                    Pull {selected.length} in
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="table-mini">
                <thead>
                  <tr>
                    <th className="w-10">
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={(e) =>
                          setSelected(e.target.checked ? pageRows.map((r) => r.sku) : [])
                        }
                        aria-label="Select all on this page"
                      />
                    </th>
                    <th colSpan={2}>Listing</th>
                    <th>Their shelf</th>
                    <th className="text-right">Their price</th>
                    <th className="text-right">Ours after markup</th>
                    <th className="text-right">Stock</th>
                    <th>Here</th>
                    <th>State</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={10} className="p-8 text-center text-slate-400">
                        {search || category
                          ? 'Nothing matches that filter.'
                          : 'Nothing in this state. Run a scan if you have not yet.'}
                      </td>
                    </tr>
                  )}
                  {pageRows.map((r) => (
                    <tr key={r.sku} className="hover:bg-slate-50">
                      <td>
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
                      <td className="w-12">
                        {r.remote.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.remote.image} alt="" loading="lazy" className="thumb-sm" />
                        ) : (
                          <span
                            className="flex h-10 w-10 items-center justify-center rounded bg-slate-100 text-[10px] text-slate-400"
                            title="This listing has no image"
                          >
                            none
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="font-medium text-slate-900">{r.remote_name ?? '—'}</span>
                        <div className="mono text-xs text-slate-400">{r.sku}</div>
                        <div className="text-xs text-slate-400">
                          {r.remote.image_count ?? 0} image
                          {(r.remote.image_count ?? 0) === 1 ? '' : 's'}
                          {r.remote.variant_count ? ` · ${r.remote.variant_count} variants` : ''}
                          {r.remote.status && r.remote.status !== 'active' && (
                            <span className="ml-1 text-amber-600">· {r.remote.status} there</span>
                          )}
                        </div>
                        {r.last_error && <p className="text-xs text-red-600">{r.last_error}</p>}
                      </td>
                      <td className="text-xs text-slate-500">
                        {r.remote.category_path.length ? (
                          r.remote.category_path.join(' › ')
                        ) : (
                          <span className="text-amber-600">none</span>
                        )}
                      </td>
                      <td className="text-right text-slate-500">
                        {r.remote.price == null ? '—' : inr(r.remote.price)}
                      </td>
                      <td className="text-right font-medium text-slate-900">
                        {r.remote.landed_price == null ? '—' : inr(r.remote.landed_price)}
                      </td>
                      <td className="text-right">
                        {r.remote.stock == null ? (
                          '—'
                        ) : r.remote.stock > 0 ? (
                          r.remote.stock
                        ) : (
                          <span className="text-red-600">0</span>
                        )}
                      </td>
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
                          <button
                            type="button"
                            className="link"
                            onClick={() => importSkus([r.sku])}
                            disabled={busy !== null}
                          >
                            {r.product ? 'Update' : 'Pull in'}
                          </button>
                          <button
                            type="button"
                            className="text-slate-500 hover:underline"
                            onClick={() => setIgnored([r.sku], !r.ignored)}
                            disabled={busy !== null}
                          >
                            {r.ignored ? 'Restore' : 'Skip'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {total > PAGE && (
              <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
                <span>
                  {page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} of {total}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="link disabled:text-slate-300"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="link disabled:text-slate-300"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={(page + 1) * PAGE >= total}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {diffSku && <DiffModal sku={diffSku} onClose={() => setDiffSku(null)} />}
    </div>
  );
}
