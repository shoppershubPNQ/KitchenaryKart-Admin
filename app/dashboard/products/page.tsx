'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, inr, inrExact } from '@/lib/fetch';
import { Icon } from '@/components/Icons';
import { computeProductGst } from '@/lib/product-pricing';

interface Product {
  id: number;
  sku: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  price: number;
  mrp: number | null;
  taxPercent: number | string;
  hsnCode: string | null;
  stock: number;
  reorderPoint: number;
  status: string;
  imageUrl: string | null;
  isBestseller: boolean;
  isNewArrival: boolean;
  _count?: { variants: number };
}

interface Variant {
  id: number;
  variantType: string | null;
  variantValue: string | null;
  skuSuffix: string | null;
  priceModifier: number | string;
  /** Absolute GST-inclusive price. When set it WINS over parent + modifier —
   *  same precedence the storefront and checkout apply. */
  price: number | string | null;
  stock: number;
  imageUrl: string | null;
}

// Admin runs on :3000 but images are served by the website on :5500.
const IMG_BASE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:5500';
/** Public storefront origin, for "View on site". Falls back to production so
 *  the link works even where NEXT_PUBLIC_SITE_URL is unset. */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://kitchenarykart.com';
function imgSrc(url: string | null): string | null {
  if (!url) return null;
  if (/^https?:/i.test(url)) return url;
  return IMG_BASE + url;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);

  // Inline variant expansion — lazy-loaded per product and cached.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [variantsById, setVariantsById] = useState<Record<number, Variant[]>>({});
  const [variantsLoading, setVariantsLoading] = useState<Set<number>>(new Set());

  // Bulk selection. Keyed by product id and kept across pages so a selection
  // built up over several pages can be actioned in one go.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const limit = 25;

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
      if (search) params.set('search', search);
      if (category) params.set('category', category);
      if (status) params.set('status', status);
      const data = await api<{ products: Product[]; total: number }>('/api/products?' + params);
      setProducts(data.products);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, category, status]);

  useEffect(() => {
    api<{ categories: { name: string }[] }>('/api/categories').then(d => setCategories(d.categories.map(c => c.name)));
  }, []);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => { setPage(0); load(); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [search]);

  async function toggleExpand(p: Product) {
    const next = new Set(expanded);
    if (next.has(p.id)) {
      next.delete(p.id);
      setExpanded(next);
      return;
    }
    next.add(p.id);
    setExpanded(next);
    // Lazy-load variants the first time a product with variants is opened.
    if ((p._count?.variants ?? 0) > 0 && !variantsById[p.id]) {
      setVariantsLoading((prev) => new Set(prev).add(p.id));
      try {
        const data = await api<{ variants: Variant[] }>(`/api/products/${p.id}/variants`);
        setVariantsById((prev) => ({ ...prev, [p.id]: data.variants }));
      } catch {
        setVariantsById((prev) => ({ ...prev, [p.id]: [] }));
      } finally {
        setVariantsLoading((prev) => { const s = new Set(prev); s.delete(p.id); return s; });
      }
    }
  }

  async function remove(id: number) {
    if (!confirm('Delete this product?')) return;
    await api(`/api/products/${id}`, { method: 'DELETE' });
    load();
  }

  // Toggle a merchandising flag (`isBestseller` / `isNewArrival`) in place.
  // Optimistic update with a rollback if the server rejects the PATCH.
  async function toggleFlag(p: Product, field: 'isBestseller' | 'isNewArrival') {
    const next = !p[field];
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, [field]: next } : x)));
    try {
      await api(`/api/products/${p.id}`, { method: 'PATCH', body: JSON.stringify({ [field]: next }) });
    } catch (e) {
      setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, [field]: !next } : x)));
      alert('Could not update. Please retry.');
    }
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  const pageIds = products.map((p) => p.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  function toggleSelectPage() {
    setSelected((prev) => {
      const n = new Set(prev);
      if (allOnPageSelected) pageIds.forEach((id) => n.delete(id));
      else pageIds.forEach((id) => n.add(id));
      return n;
    });
  }

  /** One change applied to every selected product. Confirmed first — this
   *  reaches the live storefront and can touch hundreds of rows. */
  async function bulkApply(data: Record<string, unknown>, label: string) {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`${label} for ${ids.length} product${ids.length > 1 ? 's' : ''}?`)) return;
    setBulkBusy(true);
    try {
      const res = await api<{ updated: number; variantsUpdated: number }>(
        '/api/products/bulk-update',
        { method: 'POST', body: JSON.stringify({ ids, data }) },
      );
      setSelected(new Set());
      setVariantsById({});
      await load();
      alert(
        `${res.updated} product${res.updated === 1 ? '' : 's'} updated` +
        (res.variantsUpdated ? ` · ${res.variantsUpdated} variants` : ''),
      );
    } catch (e: any) {
      alert(e?.message || 'Bulk update failed');
    } finally {
      setBulkBusy(false);
    }
  }

  /** Fold one selected listing into the other. Offered only for exactly two
   *  selections, because a merge needs an unambiguous source and target. */
  async function mergeSelected() {
    const ids = [...selected];
    if (ids.length !== 2) return;
    const a = products.find((p) => p.id === ids[0]);
    const b = products.find((p) => p.id === ids[1]);
    if (!a || !b) { alert('Both products must be on this page to merge.'); return; }

    const keepA = confirm(
      `Which listing do you want to KEEP?\n\n` +
      `OK    = keep "${a.name}" (${a.sku})\n` +
      `Cancel = keep "${b.name}" (${b.sku})`,
    );
    const target = keepA ? a : b;
    const source = keepA ? b : a;

    const asVariantValue = prompt(
      `"${source.name}" (${source.sku}) will be folded into "${target.name}".\n\n` +
      `Its VARIANTS move across automatically.\n\n` +
      `To also keep the source product itself as a size/option on the target, ` +
      `type that option's name (e.g. "34cm", "Gold").\n` +
      `Leave BLANK to move only its variants.`,
      '',
    );
    if (asVariantValue === null) return;

    const sourceAsVariant = asVariantValue.trim()
      ? { variantType: 'Size', variantValue: asVariantValue.trim() }
      : null;

    if (!confirm(
      `Merge confirmation\n\n` +
      `KEEP:   ${target.name} (${target.sku})\n` +
      `FOLD IN: ${source.name} (${source.sku})\n` +
      (sourceAsVariant ? `        …added as option "${sourceAsVariant.variantValue}"\n` : '') +
      `\nThe folded listing is DISCONTINUED, not deleted — order history stays intact.\nProceed?`,
    )) return;

    setBulkBusy(true);
    try {
      const r = await api<{ variantsMoved: number; sourceAddedAsVariant: boolean; warnings: string[] }>(
        '/api/products/merge',
        {
          method: 'POST',
          body: JSON.stringify({ sourceId: source.id, targetId: target.id, moveVariants: true, sourceAsVariant }),
        },
      );
      setSelected(new Set());
      setVariantsById({});
      await load();
      alert(
        `Merged into ${target.sku}.\n` +
        `${r.variantsMoved} variant${r.variantsMoved === 1 ? '' : 's'} moved` +
        (r.sourceAddedAsVariant ? ' · source added as an option' : '') +
        (r.warnings?.length ? `\n\n⚠ ${r.warnings.join('\n⚠ ')}` : ''),
      );
    } catch (e: any) {
      alert(e?.message || 'Merge failed');
    } finally {
      setBulkBusy(false);
    }
  }

  const hasFilters = !!(search || category || status);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Products</h1>
          <p className="text-sm text-slate-500 mt-0.5">{total.toLocaleString('en-IN')} total SKUs</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <a href="/api/products/export" className="btn-outline gap-1.5" download>
            <Icon name="products" className="w-4 h-4" /> Export
          </a>
          <a href="/api/variants/export" className="btn-outline gap-1.5" download>
            <Icon name="variants" className="w-4 h-4" /> Export variants
          </a>
          <Link href="/dashboard/products/import" className="btn-outline">Bulk import</Link>
          <Link href="/dashboard/products/new" className="btn-primary gap-1.5">
            <Icon name="chevron" className="w-4 h-4 rotate-90 hidden" />
            <span className="text-base leading-none">+</span> New product
          </Link>
        </div>
      </div>

      {/* Toolbar */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <svg viewBox="0 0 24 24" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input className="input pl-9" placeholder="Search name, SKU or variant SKU…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input max-w-[200px]" value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input max-w-[160px]" value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="discontinued">Discontinued</option>
        </select>
        {hasFilters && (
          <button
            className="text-sm text-slate-500 hover:text-brand"
            onClick={() => { setSearch(''); setCategory(''); setStatus(''); setPage(0); }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      {/* Bulk action bar — appears only with a selection. */}
      {selected.size > 0 && (
        <div className="card p-3 flex flex-wrap items-center gap-2 border-l-4 border-brand bg-slate-50">
          <span className="text-sm font-medium text-slate-800">
            {selected.size} selected
          </span>
          <button onClick={() => setSelected(new Set())} className="text-xs text-slate-500 hover:underline mr-2">
            Clear
          </button>

          <div className="h-5 w-px bg-slate-300" />

          <button disabled={bulkBusy} onClick={() => bulkApply({ status: 'active' }, 'Set status to ACTIVE')}
            className="btn-outline text-xs">Set Active</button>
          <button disabled={bulkBusy} onClick={() => bulkApply({ status: 'draft' }, 'Move to DRAFT')}
            className="btn-outline text-xs">Move to Draft</button>
          <button disabled={bulkBusy} onClick={() => bulkApply({ status: 'discontinued' }, 'Mark DISCONTINUED')}
            className="btn-outline text-xs">Discontinue</button>

          <div className="h-5 w-px bg-slate-300" />

          <button disabled={bulkBusy}
            onClick={() => {
              const raw = prompt(`Set stock for ${selected.size} product(s) to:`, '0');
              if (raw === null) return;
              const n = parseInt(raw, 10);
              if (!Number.isFinite(n) || n < 0) { alert('Enter a whole number, 0 or more.'); return; }
              // Products WITH variants sell from the variant rows, so the count
              // has to reach those too or the change does nothing on the site.
              const alsoVariants = confirm(
                `Also set every VARIANT of these products to ${n}?\n\nOK = yes (needed for products that sell by size)\nCancel = parent rows only`,
              );
              bulkApply({ stock: n, applyStockToVariants: alsoVariants }, `Set stock to ${n}`);
            }}
            className="btn-outline text-xs">Set Stock…</button>

          <button disabled={bulkBusy} onClick={() => bulkApply({ isBestseller: true }, 'Flag as BEST SELLER')}
            className="btn-outline text-xs">Mark Bestseller</button>
          <button disabled={bulkBusy} onClick={() => bulkApply({ isNewArrival: true }, 'Flag as NEW ARRIVAL')}
            className="btn-outline text-xs">Mark New</button>

          <div className="h-5 w-px bg-slate-300" />

          {/* Merge needs an unambiguous source and target, so it is offered
              only for a selection of exactly two. */}
          <button
            disabled={bulkBusy || selected.size !== 2}
            onClick={mergeSelected}
            title={selected.size === 2
              ? 'Fold one of these listings into the other'
              : 'Select exactly 2 products to merge'}
            className="btn-outline text-xs disabled:opacity-40"
          >
            Merge 2 listings…
          </button>

          {bulkBusy && <span className="text-xs text-slate-500">applying…</span>}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <Th className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allOnPageSelected}
                    onChange={toggleSelectPage}
                    className="align-middle"
                  />
                </Th>
                <Th className="w-8"></Th>
                <Th className="w-14"></Th>
                <Th>Product</Th>
                <Th>Category</Th>
                <Th align="right">Price</Th>
                <Th align="right">Stock</Th>
                <Th>Status</Th>
                <Th>Merchandising</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={10} className="p-10 text-center text-slate-400">Loading…</td></tr>}
              {!loading && products.length === 0 && (
                <tr><td colSpan={10} className="p-10 text-center text-slate-400">No products match your filters.</td></tr>
              )}
              {!loading && products.map(p => {
                const vCount = p._count?.variants ?? 0;
                const isOpen = expanded.has(p.id);
                return (
                  <ProductRow
                    key={p.id}
                    product={p}
                    vCount={vCount}
                    isOpen={isOpen}
                    variants={variantsById[p.id]}
                    variantsLoading={variantsLoading.has(p.id)}
                    onToggleExpand={() => toggleExpand(p)}
                    onToggleFlag={toggleFlag}
                    onRemove={remove}
                    isSelected={selected.has(p.id)}
                    onToggleSelect={() => toggleSelect(p.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination page={page} total={total} limit={limit} onPage={setPage} />
    </div>
  );
}

function ProductRow({
  product: p,
  vCount,
  isOpen,
  variants,
  variantsLoading,
  onToggleExpand,
  onToggleFlag,
  onRemove,
  isSelected,
  onToggleSelect,
}: {
  product: Product;
  vCount: number;
  isOpen: boolean;
  variants: Variant[] | undefined;
  variantsLoading: boolean;
  onToggleExpand: () => void;
  onToggleFlag: (p: Product, field: 'isBestseller' | 'isNewArrival') => void;
  onRemove: (id: number) => void;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  return (
    <>
      <tr className={`hover:bg-slate-50/70 transition-colors ${isSelected ? 'bg-brand/5' : isOpen ? 'bg-slate-50/70' : ''}`}>
        {/* Bulk select */}
        <td className="pl-3 pr-1 py-2.5 align-middle">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            aria-label={`Select ${p.name}`}
            className="align-middle"
          />
        </td>
        {/* Expander — always available (opens pricing/GST + variants) */}
        <td className="pl-3 pr-1 py-2.5 align-middle">
          <button
            type="button"
            onClick={onToggleExpand}
            aria-label={isOpen ? 'Hide details' : 'Show pricing, GST & variants'}
            title={isOpen ? 'Hide details' : 'Show pricing, GST & variants'}
            className="w-6 h-6 grid place-items-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
          >
            <Icon name="chevron" className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          </button>
        </td>
        {/* Thumb */}
        <td className="px-1 py-2.5">
          {imgSrc(p.imageUrl) ? (
            <img src={imgSrc(p.imageUrl)!} alt="" className="w-11 h-11 object-contain bg-slate-50 rounded-md border border-slate-100" />
          ) : (
            <div className="w-11 h-11 rounded-md bg-slate-100 text-slate-300 grid place-items-center border border-slate-100">
              <Icon name="products" className="w-5 h-5" />
            </div>
          )}
        </td>
        {/* Name + SKU */}
        <td className="px-4 py-2.5">
          <Link href={`/dashboard/products/${p.id}`} className="font-medium text-slate-900 hover:text-brand">
            {p.name}
          </Link>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="font-mono text-[11px] text-slate-400">{p.sku}</span>
            {p.subcategory && <span className="text-[11px] text-slate-400">· {p.subcategory}</span>}
            {vCount > 0 && (
              <button
                onClick={onToggleExpand}
                className="pill pill-blue !py-0 !text-[10px] hover:brightness-95"
                title="View variants"
              >
                {vCount} variant{vCount === 1 ? '' : 's'}
              </button>
            )}
          </div>
        </td>
        <td className="px-4 py-2.5 text-slate-600">{p.category || '—'}</td>
        <td className="px-4 py-2.5 text-right">
          <div className="font-medium text-slate-900">{inr(p.price)}</div>
          {p.mrp != null && Number(p.mrp) > Number(p.price) && (
            <div className="text-[11px] text-slate-400 line-through">{inr(p.mrp)}</div>
          )}
        </td>
        <td className="px-4 py-2.5 text-right">
          <span className={p.stock <= p.reorderPoint ? 'pill-red' : 'pill-green'}>{p.stock}</span>
        </td>
        <td className="px-4 py-2.5">
          <span className={p.status === 'active' ? 'pill-green' : p.status === 'draft' ? 'pill-yellow' : 'pill-gray'}>
            {p.status}
          </span>
        </td>
        <td className="px-4 py-2.5">
          <div className="flex gap-1.5">
            <FlagButton on={p.isBestseller} onClick={() => onToggleFlag(p, 'isBestseller')} activeClass="bg-red-600 text-white" label="Best" title={p.isBestseller ? 'Best Seller — click to remove' : 'Mark as Best Seller'} />
            <FlagButton on={p.isNewArrival} onClick={() => onToggleFlag(p, 'isNewArrival')} activeClass="bg-emerald-600 text-white" label="New" title={p.isNewArrival ? 'New Arrival — click to remove' : 'Mark as New Arrival'} />
          </div>
        </td>
        <td className="px-4 py-2.5">
          <div className="flex items-center justify-end gap-1">
            {/* View on the live storefront. Draft/discontinued products have no
                public page, so the button is disabled rather than sending the
                admin to a redirect or a 404. */}
            {p.status === 'active' ? (
              <a
                href={`${SITE_URL}/product/${encodeURIComponent(p.sku)}`}
                target="_blank"
                rel="noreferrer"
                title="View on site"
                className="w-8 h-8 grid place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-brand"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" />
                </svg>
              </a>
            ) : (
              <span
                title={`Not on the site — this product is ${p.status}`}
                className="w-8 h-8 grid place-items-center rounded-md text-slate-300 cursor-not-allowed"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" />
                </svg>
              </span>
            )}
            <Link
              href={`/dashboard/products/${p.id}`}
              title="Edit"
              className="w-8 h-8 grid place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-brand"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
              </svg>
            </Link>
            <button
              onClick={() => onRemove(p.id)}
              title="Delete"
              className="w-8 h-8 grid place-items-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          </div>
        </td>
      </tr>

      {/* Inline details: variants (pricing/GST breakdown lives on the order page) */}
      {isOpen && (
        <tr>
          <td colSpan={10} className="p-0 border-b border-slate-100">
            <div className="bg-slate-50/60 px-4 py-4 pl-16">
              <VariantsPanel product={p} variants={variants} loading={variantsLoading} vCount={vCount} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Variant list with per-variant GST breakdown (same inclusive convention). */
function VariantsPanel({
  product: p,
  variants,
  loading,
  vCount,
}: {
  product: Product;
  variants: Variant[] | undefined;
  loading: boolean;
  vCount: number;
}) {
  if (vCount === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-white/60 grid place-items-center text-sm text-slate-400 min-h-[120px]">
        No variants for this product.
      </div>
    );
  }
  if (loading || !variants) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white grid place-items-center text-sm text-slate-400 min-h-[120px]">
        Loading variants…
      </div>
    );
  }
  const rate = Number(p.taxPercent) || 0;
  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Variants <span className="text-slate-400">({variants.length})</span>
        </h4>
        <div className="flex items-center gap-3">
          <CopyImagesButton product={p} variants={variants} />
          <Link href={`/dashboard/products/${p.id}`} className="text-xs font-medium text-brand hover:underline">
            Manage →
          </Link>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-white text-slate-500 border-b border-slate-200">
              {/* The variant panel never showed an image, so a variant with no
                  photo of its own was invisible here — you had to open the edit
                  page to find out. The API already returns imageUrl. */}
              <th className="px-3 py-2 text-left font-medium w-12">Photo</th>
              <th className="px-3 py-2 text-left font-medium">Option</th>
              <th className="px-3 py-2 text-left font-medium">Variant SKU</th>
              <th className="px-3 py-2 text-right font-medium">Net (ex-GST)</th>
              <th className="px-3 py-2 text-right font-medium">GST</th>
              <th className="px-3 py-2 text-right font-medium">Price (incl.)</th>
              <th className="px-3 py-2 text-right font-medium">Stock</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {variants.map((v) => {
              // Show what the customer is actually charged. An absolute
              // per-variant price wins over parent + modifier, exactly as
              // checkout and the storefront PDP resolve it — otherwise a stale
              // or junk modifier renders a price nobody will ever pay (one
              // import artifact had 9 variants displaying -Rs 44 against a real
              // Rs 810, and a live steamer still shows its parent's old price).
              const mod = Number(v.priceModifier || 0);
              const hasAbsolute = v.price !== null && v.price !== undefined && v.price !== '';
              const effective = hasAbsolute ? Number(v.price) : Number(p.price) + mod;
              const g = computeProductGst(effective, rate, null);
              return (
                <tr key={v.id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2">
                    <VariantThumb url={v.imageUrl} alt={v.variantValue || p.name} />
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-slate-400">{v.variantType || '—'}:</span>{' '}
                    <span className="font-medium text-slate-800">{v.variantValue || '—'}</span>
                  </td>
                  {/* Despite the column name, skuSuffix holds a COMPLETE sku in
                      this catalogue — all 1,037 variant rows start with "KK".
                      Concatenating it onto the parent produced doubled codes
                      like "KKBT0264-372KKBT0277-232", which match nothing and
                      cannot be searched, scanned or quoted to a customer. */}
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{v.skuSuffix || p.sku}</td>
                  {/* Paise shown on purpose: these three columns must visibly
                      add up. Rounded to whole rupees a ₹66 variant at 5% read
                      "₹62 + ₹3", which looks like a missing rupee and like the
                      wrong GST rate — the arithmetic was right all along. */}
                  <td className="px-3 py-2 text-right text-slate-600 tabular-nums">{inrExact(g.net)}</td>
                  <td className="px-3 py-2 text-right text-slate-600 tabular-nums">
                    {inrExact(g.gst)}
                    <span className="ml-1 text-[10px] text-slate-400">@{g.rate}%</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className="font-medium text-slate-900">{inrExact(g.inclusive)}</span>
                    {/* Only annotate with the modifier when it is what actually
                        produced the price. With an absolute price set, the
                        modifier is inert and showing it reads as a discount
                        that does not exist. */}
                    {!hasAbsolute && mod !== 0 && (
                      <span className={`ml-1 text-[11px] ${mod > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        ({mod > 0 ? '+' : ''}{inr(mod)})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {/* Editable in place: correcting one size's count used to
                        mean opening the parent's edit page and saving the whole
                        product. */}
                    <VariantStock variant={v} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Pushes the parent's gallery onto its variants. Variants that already carry
 *  their own photo are skipped by default — a size-specific shot is better
 *  than the parent's and must not be overwritten. */
function CopyImagesButton({ product, variants }: { product: Product; variants: Variant[] | undefined }) {
  const [busy, setBusy] = useState(false);

  // The source can be the parent OR any sibling that has a photo — the API
  // falls back to a sibling when the parent's own slot is empty. Gating on
  // the parent alone used to HIDE this button in exactly the case it was
  // needed: a size folded in by a merge, sitting imageless next to siblings
  // that already had pictures.
  const siblingHasImage = (variants ?? []).some((v) => !!v.imageUrl);
  const canFill = !!product.imageUrl || siblingHasImage;
  const missing = (variants ?? []).filter((v) => !v.imageUrl).length;
  if (!canFill) return null;

  async function run(overwrite: boolean) {
    setBusy(true);
    try {
      const r = await api<{ updated: number; skipped: number; source?: string; message?: string }>(
        `/api/products/${product.id}/copy-images-to-variants`,
        { method: 'POST', body: JSON.stringify({ overwrite }) },
      );
      alert(
        r.updated
          ? `${r.updated} variant${r.updated === 1 ? '' : 's'} updated from the ${r.source ?? 'parent'}` +
            (r.skipped ? ` · ${r.skipped} left alone` : '') +
            '\n\nReopen the row to see the thumbnails.'
          : (r.message || 'Nothing to update'),
      );
    } catch (e: any) {
      alert(e?.message || 'Could not copy images');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy || missing === 0}
        title={missing
          ? `Give the ${missing} variant(s) with no photo the ${product.imageUrl ? "parent's" : "first sibling's"} image`
          : 'Every variant already has a photo'}
        onClick={() => {
          if (!confirm(
            `Fill the ${missing} variant(s) that have NO photo?\n\n` +
            `Source: ${product.imageUrl ? 'the parent product' : 'the first sibling variant that has one'}\n` +
            `Variants with their own photo are left alone.`,
          )) return;
          run(false);
        }}
        className="text-xs font-medium text-slate-500 hover:text-brand hover:underline disabled:opacity-40"
      >
        {busy ? 'Copying…' : `Fill missing photos${missing ? ` (${missing})` : ''}`}
      </button>
      <span className="text-slate-300">·</span>
      {/* Destructive: replaces size-specific shots with one shared image. */}
      <button
        type="button"
        disabled={busy}
        title="Overwrite EVERY variant with the same image, including ones that have their own"
        onClick={() => {
          if (!confirm(
            'Give EVERY variant the same image?\n\n' +
            '⚠ This OVERWRITES variants that have their own size- or colour-specific photo, ' +
            'and that cannot be undone from here.\n\nContinue?',
          )) return;
          run(true);
        }}
        className="text-xs font-medium text-slate-400 hover:text-amber-600 hover:underline disabled:opacity-40"
      >
        Apply to all
      </button>
    </span>
  );
}

/** Variant photo, or an explicit "no photo" marker — a blank cell reads as
 *  "not loaded" rather than "this variant has no image". */
function VariantThumb({ url, alt }: { url: string | null; alt: string }) {
  const src = imgSrc(url);
  if (!src) {
    return (
      <div
        title="No photo on this variant — it falls back to the parent's image"
        className="w-9 h-9 rounded border border-dashed border-slate-300 bg-slate-50 grid place-items-center text-[9px] text-slate-400 leading-none text-center"
      >
        no<br />photo
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className="w-9 h-9 rounded border border-slate-200 object-cover bg-white"
      loading="lazy"
    />
  );
}

/** Inline stock editor for one variant. Commits on blur / Enter, reverts on
 *  Escape, and rolls back if the PATCH fails so the number on screen is never
 *  a count the database does not hold. */
function VariantStock({ variant }: { variant: Variant }) {
  const [value, setValue] = useState(String(variant.stock));
  const [saved, setSaved] = useState(variant.stock);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function commit() {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n < 0) { setValue(String(saved)); return; }
    if (n === saved) return;
    setBusy(true);
    setError(false);
    try {
      await api(`/api/variants/${variant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ stock: n }),
      });
      setSaved(n);
    } catch {
      setError(true);
      setValue(String(saved));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5 justify-end">
      {error && <span className="text-[10px] text-red-600">failed</span>}
      <input
        type="number"
        min={0}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setValue(String(saved)); (e.target as HTMLInputElement).blur(); }
        }}
        className={`w-20 text-right tabular-nums rounded border px-2 py-1 text-[13px] outline-none focus:border-brand focus:ring-1 focus:ring-brand disabled:opacity-50 ${
          saved <= 0 ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white'
        }`}
      />
    </span>
  );
}

function FlagButton({ on, onClick, activeClass, label, title }: { on: boolean; onClick: () => void; activeClass: string; label: string; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide transition ${on ? activeClass : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
    >
      {label}
    </button>
  );
}

function Th({ children, align = 'left', className = '' }: { children?: React.ReactNode; align?: 'left' | 'right'; className?: string }) {
  return <th className={`px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide text-${align} ${className}`}>{children}</th>;
}

function Pagination({ page, total, limit, onPage }: { page: number; total: number; limit: number; onPage: (p: number) => void }) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="text-slate-500">Page {page + 1} of {pages}</div>
      <div className="flex gap-2">
        <button className="btn-outline gap-1" disabled={page === 0} onClick={() => onPage(page - 1)}>
          <Icon name="chevron" className="w-4 h-4 rotate-180" /> Prev
        </button>
        <button className="btn-outline gap-1" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
          Next <Icon name="chevron" className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
