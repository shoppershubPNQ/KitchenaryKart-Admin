'use client';

/**
 * Collections page — curate which **individual products** appear under the
 * home page's Best Seller and New Arrival tabs.
 *
 * Workflow: type in the search box to find any product across the whole
 * catalog (by name or SKU), click a result to add it, then drag the selected
 * rows to reorder. The saved order is the exact order the storefront renders,
 * so the top of the list shows first on the home page.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, inr } from '@/lib/fetch';

interface Collection {
  id: number;
  slug: string;
  name: string;
  subcategories: unknown;
  productSkus: unknown;
  isActive: boolean;
}
interface ProductLite {
  sku: string;
  name: string;
  imageUrl: string | null;
  price: number;
}
type CatalogItem = ProductLite & { category: string; subName: string };
interface SubNode {
  subName: string;
  products: ProductLite[];
}
type Tree = Record<string, SubNode[]>;
interface ApiResponse {
  collections: Collection[];
  tree: Tree;
}

function asList(raw: unknown): string[] {
  return Array.isArray(raw) ? (raw.filter((x) => typeof x === 'string') as string[]) : [];
}

export default function CollectionsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await api<ApiResponse>('/api/collections'));
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Flatten the category → subcategory tree into one searchable catalog plus a
  // sku → product lookup, so search scans every product at once (not per-sub).
  const { catalog, bySku } = useMemo(() => {
    const catalog: CatalogItem[] = [];
    const bySku = new Map<string, CatalogItem>();
    if (data) {
      for (const [cat, subs] of Object.entries(data.tree)) {
        for (const s of subs) {
          for (const p of s.products) {
            const item: CatalogItem = { ...p, category: cat, subName: s.subName };
            catalog.push(item);
            bySku.set(p.sku, item);
          }
        }
      }
    }
    return { catalog, bySku };
  }, [data]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Collections</h1>
        <p className="text-sm text-slate-500">
          Search the catalog to add <strong>products</strong> to the{' '}
          <strong>Best Seller</strong> and <strong>New Arrival</strong> tabs on the
          storefront home page, then <strong>drag to reorder</strong> — the order here
          is the order shown on the site. Remember to <strong>Save</strong>.
        </p>
      </div>

      {error && (
        <div className="card p-4 text-sm text-red-600 bg-red-50 border border-red-200">
          {error}
        </div>
      )}

      {loading && <div className="card p-8 text-center text-slate-400">Loading…</div>}

      {!loading && data && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {data.collections.map((c) => (
            <CollectionCard
              key={c.slug}
              collection={c}
              catalog={catalog}
              bySku={bySku}
              onSaved={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CollectionCard({
  collection,
  catalog,
  bySku,
  onSaved,
}: {
  collection: Collection;
  catalog: CatalogItem[];
  bySku: Map<string, CatalogItem>;
  onSaved: () => void;
}) {
  const initial = useMemo(() => asList(collection.productSkus), [collection]);
  const [skus, setSkus] = useState<string[]>(initial); // ordered selection
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const dragIndex = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Reset local state when the parent reloads with fresh server data.
  useEffect(() => {
    setSkus(initial);
    setSaveOk(false);
  }, [initial]);

  const dirty = useMemo(() => {
    if (skus.length !== initial.length) return true;
    return skus.some((s, i) => s !== initial[i]);
  }, [skus, initial]);

  const selectedSet = useMemo(() => new Set(skus), [skus]);

  // Search matches product name or SKU, skips already-selected, caps at 30.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: CatalogItem[] = [];
    for (const p of catalog) {
      if (selectedSet.has(p.sku)) continue;
      if (p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)) {
        out.push(p);
        if (out.length >= 30) break;
      }
    }
    return out;
  }, [query, catalog, selectedSet]);

  function add(sku: string) {
    setSkus((p) => (p.includes(sku) ? p : [...p, sku]));
    setSaveOk(false);
  }
  function remove(sku: string) {
    setSkus((p) => p.filter((s) => s !== sku));
    setSaveOk(false);
  }
  function clearAll() {
    setSkus([]);
    setSaveOk(false);
  }

  function onDropAt(target: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    setDragOver(null);
    if (from == null || from === target) return;
    setSkus((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(target, 0, moved);
      return next;
    });
    setSaveOk(false);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      await api(`/api/collections/${collection.slug}`, {
        method: 'PATCH',
        body: JSON.stringify({ productSkus: skus }),
      });
      setSaveOk(true);
      onSaved();
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{collection.name}</h2>
          <div className="text-xs text-slate-500">
            {skus.length} product{skus.length === 1 ? '' : 's'} · shown in this order
          </div>
        </div>
        <div className="flex items-center gap-3">
          {skus.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-slate-500 hover:text-red-600"
            >
              Clear all
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      {saveError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {saveError}
        </div>
      )}
      {saveOk && (
        <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
          Saved. The storefront tab updates within a few seconds.
        </div>
      )}

      {/* Search — scans the whole catalog by name or SKU */}
      <div>
        <input
          type="search"
          placeholder="Search products by name or SKU…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="input"
        />
        {query.trim() && (
          <div className="mt-1 border border-slate-200 rounded-md max-h-72 overflow-y-auto divide-y divide-slate-100">
            {results.length === 0 ? (
              <div className="p-4 text-center text-sm text-slate-400">
                No products match &ldquo;{query}&rdquo;.
              </div>
            ) : (
              results.map((p) => (
                <button
                  key={p.sku}
                  type="button"
                  onClick={() => add(p.sku)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 transition"
                >
                  <Thumb p={p} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-800">{p.name}</span>
                    <span className="block truncate text-[11px] text-slate-400">
                      {p.sku} · {p.category} › {p.subName} · {inr(p.price)}
                    </span>
                  </span>
                  <span className="text-brand text-xl leading-none shrink-0" aria-hidden>
                    +
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Selected — drag to reorder */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
          Selected — drag to reorder
        </div>
        {skus.length === 0 ? (
          <div className="border border-dashed border-slate-200 rounded-md p-6 text-center text-sm text-slate-400">
            No products yet. Search above and click a result to add it.
          </div>
        ) : (
          <ul className="border border-slate-200 rounded-md divide-y divide-slate-100">
            {skus.map((sku, i) => {
              const p = bySku.get(sku);
              return (
                <li
                  key={sku}
                  draggable
                  onDragStart={() => {
                    dragIndex.current = i;
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOver !== i) setDragOver(i);
                  }}
                  onDragLeave={() => setDragOver((d) => (d === i ? null : d))}
                  onDrop={() => onDropAt(i)}
                  onDragEnd={() => {
                    dragIndex.current = null;
                    setDragOver(null);
                  }}
                  className={`flex items-center gap-3 px-3 py-2 bg-white transition ${
                    dragOver === i ? 'bg-brand/5 ring-1 ring-inset ring-brand/40' : ''
                  }`}
                >
                  <span
                    className="cursor-grab active:cursor-grabbing text-slate-300 select-none leading-none"
                    title="Drag to reorder"
                    aria-hidden
                  >
                    ⠿
                  </span>
                  <span className="text-xs tabular-nums text-slate-400 w-5 shrink-0 text-right">
                    {i + 1}
                  </span>
                  {p ? (
                    <Thumb p={p} />
                  ) : (
                    <span className="w-9 h-9 rounded bg-slate-100 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-800">
                      {p?.name ?? sku}
                    </span>
                    <span className="block truncate text-[11px] text-slate-400">
                      {sku}
                      {p ? ` · ${p.category}` : ' · not in active catalog'}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(sku)}
                    aria-label="Remove"
                    className="text-slate-400 hover:text-red-600 shrink-0 text-xl leading-none px-1"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Thumb({ p }: { p: ProductLite }) {
  return p.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={p.imageUrl}
      alt=""
      className="w-9 h-9 rounded object-cover bg-slate-100 shrink-0"
      loading="lazy"
    />
  ) : (
    <span className="w-9 h-9 rounded bg-slate-100 grid place-items-center text-[10px] text-slate-400 shrink-0">
      —
    </span>
  );
}
