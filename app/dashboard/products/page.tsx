'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, inr } from '@/lib/fetch';
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
  stock: number;
  imageUrl: string | null;
}

// Admin runs on :3000 but images are served by the website on :5500.
const IMG_BASE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:5500';
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
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
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
              {loading && <tr><td colSpan={9} className="p-10 text-center text-slate-400">Loading…</td></tr>}
              {!loading && products.length === 0 && (
                <tr><td colSpan={9} className="p-10 text-center text-slate-400">No products match your filters.</td></tr>
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
}: {
  product: Product;
  vCount: number;
  isOpen: boolean;
  variants: Variant[] | undefined;
  variantsLoading: boolean;
  onToggleExpand: () => void;
  onToggleFlag: (p: Product, field: 'isBestseller' | 'isNewArrival') => void;
  onRemove: (id: number) => void;
}) {
  return (
    <>
      <tr className={`hover:bg-slate-50/70 transition-colors ${isOpen ? 'bg-slate-50/70' : ''}`}>
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
          <td colSpan={9} className="p-0 border-b border-slate-100">
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
        <Link href={`/dashboard/products/${p.id}`} className="text-xs font-medium text-brand hover:underline">
          Manage →
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-white text-slate-500 border-b border-slate-200">
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
              const mod = Number(v.priceModifier || 0);
              const g = computeProductGst(Number(p.price) + mod, rate, null);
              return (
                <tr key={v.id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2">
                    <span className="text-slate-400">{v.variantType || '—'}:</span>{' '}
                    <span className="font-medium text-slate-800">{v.variantValue || '—'}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{p.sku}{v.skuSuffix || ''}</td>
                  <td className="px-3 py-2 text-right text-slate-600 tabular-nums">{inr(g.net)}</td>
                  <td className="px-3 py-2 text-right text-slate-600 tabular-nums">{inr(g.gst)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className="font-medium text-slate-900">{inr(g.inclusive)}</span>
                    {mod !== 0 && (
                      <span className={`ml-1 text-[11px] ${mod > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        ({mod > 0 ? '+' : ''}{inr(mod)})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={v.stock <= 0 ? 'pill-red' : 'pill-gray'}>{v.stock}</span>
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
