'use client';

/**
 * Collections page — curate which **individual products** appear under the
 * home page's Best Seller and New Arrival tabs.
 *
 * Layout: each collection card lists every subcategory in the catalog as a
 * collapsible row. Clicking a row reveals the products in that subcategory
 * with a checkbox per product. The admin ticks individual SKUs; nothing is
 * implicit by subcategory.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/fetch';

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
      const res = await api<ApiResponse>('/api/collections');
      setData(res);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Collections</h1>
        <p className="text-sm text-slate-500">
          Pick which <strong>products</strong> appear under the{' '}
          <strong>Best Seller</strong> and <strong>New Arrival</strong> tabs on the
          storefront home page. Subcategories below are collapsible — open one to
          tick the products you want featured.
        </p>
      </div>

      {error && (
        <div className="card p-4 text-sm text-red-600 bg-red-50 border border-red-200">
          {error}
        </div>
      )}

      {loading && <div className="card p-8 text-center text-slate-400">Loading…</div>}

      {!loading && data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.collections.map((c) => (
            <CollectionCard
              key={c.slug}
              collection={c}
              tree={data.tree}
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
  tree,
  onSaved,
}: {
  collection: Collection;
  tree: Tree;
  onSaved: () => void;
}) {
  const initialSkus = useMemo(
    () => new Set(asList(collection.productSkus)),
    [collection],
  );
  const [selected, setSelected] = useState<Set<string>>(initialSkus);
  const [filter, setFilter] = useState('');
  const [openSub, setOpenSub] = useState<string | null>(null); // "cat||sub" key
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  // Reset local state when the parent reloads.
  useEffect(() => {
    setSelected(initialSkus);
    setSaveOk(false);
  }, [initialSkus]);

  const dirty = useMemo(() => {
    if (selected.size !== initialSkus.size) return true;
    for (const s of selected) if (!initialSkus.has(s)) return true;
    return false;
  }, [selected, initialSkus]);

  function toggle(sku: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
    setSaveOk(false);
  }

  function selectAllIn(products: ProductLite[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of products) next.add(p.sku);
      return next;
    });
    setSaveOk(false);
  }

  function clearAllIn(products: ProductLite[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of products) next.delete(p.sku);
      return next;
    });
    setSaveOk(false);
  }

  function clearAll() {
    setSelected(new Set());
    setSaveOk(false);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      await api(`/api/collections/${collection.slug}`, {
        method: 'PATCH',
        body: JSON.stringify({ productSkus: Array.from(selected) }),
      });
      setSaveOk(true);
      onSaved();
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // Filter the tree. The query matches against subcategory name, category
  // name, product name, and SKU — so admin can search "ICE" to find every
  // subcategory containing ice and every product whose name has "ice" in it.
  const filterQ = filter.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    const cats = Object.keys(tree).sort();
    if (!filterQ) return cats.map((cat) => ({ cat, subs: tree[cat] }));
    return cats
      .map((cat) => {
        const subs = tree[cat]
          .map((s) => {
            const subMatches =
              s.subName.toLowerCase().includes(filterQ) ||
              cat.toLowerCase().includes(filterQ);
            const matchedProducts = subMatches
              ? s.products
              : s.products.filter(
                  (p) =>
                    p.name.toLowerCase().includes(filterQ) ||
                    p.sku.toLowerCase().includes(filterQ),
                );
            return matchedProducts.length > 0
              ? { subName: s.subName, products: matchedProducts }
              : null;
          })
          .filter(Boolean) as SubNode[];
        return subs.length > 0 ? { cat, subs } : null;
      })
      .filter(Boolean) as { cat: string; subs: SubNode[] }[];
  }, [tree, filterQ]);

  return (
    <div className="card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{collection.name}</h2>
          <div className="text-xs text-slate-500">
            {selected.size} product{selected.size === 1 ? '' : 's'} selected
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
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
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <input
        type="search"
        placeholder="Filter subcategories or products…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="input"
      />

      {saveError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {saveError}
        </div>
      )}
      {saveOk && (
        <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
          Saved. The storefront tab updates automatically.
        </div>
      )}

      <div className="border border-slate-200 rounded-md max-h-[560px] overflow-y-auto">
        {filteredEntries.length === 0 && (
          <div className="p-6 text-center text-sm text-slate-400">
            Nothing matches "{filter}".
          </div>
        )}
        {filteredEntries.map(({ cat, subs }) => (
          <div key={cat} className="border-b border-slate-100 last:border-b-0">
            <div className="px-3 py-2 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-700">
              {cat}
            </div>
            {subs.map((s) => {
              const key = `${cat}||${s.subName}`;
              const isOpen = openSub === key || !!filterQ;
              const selectedHere = s.products.filter((p) =>
                selected.has(p.sku),
              ).length;
              const allHere = selectedHere === s.products.length && s.products.length > 0;
              return (
                <div key={key} className="border-b border-slate-100 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setOpenSub(isOpen && !filterQ ? null : key)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50 transition"
                    aria-expanded={isOpen}
                  >
                    <span className="flex items-center gap-2 text-sm text-slate-800">
                      <Chevron open={isOpen} />
                      <span className="font-medium">{s.subName}</span>
                      <span className="text-xs text-slate-400">
                        · {selectedHere}/{s.products.length}
                      </span>
                    </span>
                    {isOpen && s.products.length > 0 && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (allHere) clearAllIn(s.products);
                          else selectAllIn(s.products);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            if (allHere) clearAllIn(s.products);
                            else selectAllIn(s.products);
                          }
                        }}
                        className={
                          allHere
                            ? 'text-[11px] text-slate-500 hover:text-red-600'
                            : 'text-[11px] text-brand hover:underline'
                        }
                      >
                        {allHere
                          ? 'Deselect all'
                          : selectedHere > 0
                          ? 'Select rest'
                          : 'Select all'}
                      </span>
                    )}
                  </button>
                  {isOpen && (
                    <ul className="px-3 pb-3 pt-1">
                      {s.products.map((p) => (
                        <li key={p.sku}>
                          <label
                            className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer hover:bg-slate-50 rounded px-1.5 py-1"
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(p.sku)}
                              onChange={() => toggle(p.sku)}
                            />
                            <span className="truncate">{p.name}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width="10"
      height="10"
      className={`transition-transform text-slate-400 ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 2l4 4-4 4" />
    </svg>
  );
}
