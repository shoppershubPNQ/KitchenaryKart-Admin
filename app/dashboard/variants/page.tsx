'use client';

/**
 * Cross-product variants flat table.
 *
 * Companion to /dashboard/products — that page is one row per parent
 * (right for editing), this page is one row per variant (right for
 * inventory + pricing operations across the catalog).
 *
 * Inline edits on stock + price modifier; image upload uses the same
 * /api/variants/[id]/image endpoint as the parent edit page. Click
 * the parent name to jump into the full parent edit page.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, inr } from '@/lib/fetch';

interface Variant {
  id: number;
  productId: number;
  variantType: string | null;
  variantValue: string | null;
  skuSuffix: string | null;
  priceModifier: number | string;
  stock: number;
  imageUrl: string | null;
  product: {
    id: number;
    sku: string;
    name: string;
    category: string | null;
    subcategory: string | null;
    price: number | string;
    mrp: number | string | null;
    status: string;
  };
}

export default function VariantsPage() {
  const [rows, setRows] = useState<Variant[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [missingImage, setMissingImage] = useState(false);
  const [page, setPage] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const limit = 50;

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(page * limit),
      });
      if (search) params.set('search', search);
      if (category) params.set('category', category);
      if (lowStock) params.set('lowStock', '1');
      if (missingImage) params.set('missingImage', '1');
      const data = await api<{ variants: Variant[]; total: number }>(
        '/api/variants?' + params,
      );
      setRows(data.variants);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [page, category, lowStock, missingImage]);
  // Debounced reload on search input
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(0);
      load();
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    api<{ categories: { name: string }[] }>('/api/categories').then((d) =>
      setCategories(d.categories.map((c) => c.name)),
    );
  }, []);

  async function patchField(v: Variant, field: 'stock' | 'priceModifier', value: number) {
    setRows((prev) =>
      prev.map((x) => (x.id === v.id ? { ...x, [field]: value } : x)),
    );
    try {
      await api(`/api/variants/${v.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value }),
      });
    } catch {
      setRows((prev) =>
        prev.map((x) => (x.id === v.id ? { ...x, [field]: v[field] } : x)),
      );
      alert('Could not update. Retry?');
    }
  }

  function effectivePrice(v: Variant): number {
    return Number(v.product.price) + Number(v.priceModifier);
  }

  const hasFilters = !!search || !!category || lowStock || missingImage;

  return (
    <div className="space-y-4 max-w-7xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Variants</h1>
          <p className="text-sm text-slate-500 mt-1">
            Flat view of every product variant. Use for inventory + pricing
            sweeps. To edit name / description / category, open the parent
            product.
          </p>
        </div>
        <div className="text-sm text-slate-500">
          {total.toLocaleString('en-IN')} variant{total === 1 ? '' : 's'}
          {hasFilters && ' matching filters'}
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3 items-center">
        <input
          className="input min-w-[260px]"
          placeholder="Search SKU, variant value, parent name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="text-sm text-ink flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={lowStock}
            onChange={(e) => {
              setLowStock(e.target.checked);
              setPage(0);
            }}
          />
          Low stock (≤ 5)
        </label>
        <label className="text-sm text-ink flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={missingImage}
            onChange={(e) => {
              setMissingImage(e.target.checked);
              setPage(0);
            }}
          />
          Missing image
        </label>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setCategory('');
              setLowStock(false);
              setMissingImage(false);
              setPage(0);
            }}
            className="text-sm text-brand hover:underline ml-auto"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left">Image</th>
                <th className="px-3 py-2 text-left">Variant SKU</th>
                <th className="px-3 py-2 text-left">Variant</th>
                <th className="px-3 py-2 text-left">Parent</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">± Modifier</th>
                <th className="px-3 py-2 text-right">Stock</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    {hasFilters
                      ? 'No variants match — try clearing filters.'
                      : 'No variants yet. Add some on a product edit page.'}
                  </td>
                </tr>
              )}
              {rows.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <VariantImageThumb variant={v} onUpdated={load} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                    {v.skuSuffix || '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                    {v.variantType || '—'}: <strong className="text-ink">{v.variantValue || '—'}</strong>
                  </td>
                  <td className="px-3 py-2 max-w-[260px]">
                    <Link
                      href={`/dashboard/products/${v.product.id}`}
                      className="text-brand hover:underline text-sm line-clamp-1"
                      title={v.product.name}
                    >
                      {v.product.name}
                    </Link>
                    <div className="text-[11px] text-slate-400 font-mono">{v.product.sku}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                    {v.product.category || '—'}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="font-semibold">{inr(effectivePrice(v))}</span>
                    <div className="text-[10px] text-slate-400">
                      base {inr(v.product.price)}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      className="input input-sm w-24 text-right"
                      defaultValue={Number(v.priceModifier)}
                      onBlur={(e) => {
                        const next = Number(e.target.value) || 0;
                        if (next !== Number(v.priceModifier))
                          patchField(v, 'priceModifier', next);
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      className={`input input-sm w-20 text-right ${
                        v.stock <= 5 ? 'border-orange-300 bg-orange-50' : ''
                      }`}
                      defaultValue={v.stock}
                      onBlur={(e) => {
                        const next = Math.trunc(Number(e.target.value) || 0);
                        if (next !== v.stock) patchField(v, 'stock', next);
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        v.product.status === 'active'
                          ? 'pill-green'
                          : v.product.status === 'discontinued'
                            ? 'pill-red'
                            : 'pill-gray'
                      }
                    >
                      {v.product.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {total > limit && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-sm">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="btn-outline disabled:opacity-40"
            >
              ← Previous
            </button>
            <span className="text-slate-500">
              Page {page + 1} of {Math.ceil(total / limit)}
            </span>
            <button
              type="button"
              disabled={(page + 1) * limit >= total}
              onClick={() => setPage((p) => p + 1)}
              className="btn-outline disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Compact image-upload cell for the variants list. Single click on
 * the thumb opens the file picker to replace. Empty state shows a
 * small "+" tile. We keep this simpler than the full mini-gallery
 * on the product edit page — for cross-catalog scanning, one image
 * per row is the right density.
 */
function VariantImageThumb({
  variant,
  onUpdated,
}: {
  variant: Variant;
  onUpdated: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('files', files[0]);
      const res = await fetch(`/api/variants/${variant.id}/image`, {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Upload failed');
        return;
      }
      onUpdated();
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="relative">
      <input
        ref={fileRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.gif"
        className="hidden"
        onChange={(e) => upload(e.target.files)}
      />
      {variant.imageUrl ? (
        <img
          src={variant.imageUrl}
          alt=""
          className="w-10 h-10 rounded border border-slate-200 bg-slate-50 object-contain cursor-pointer hover:opacity-80"
          onClick={() => !busy && fileRef.current?.click()}
          title="Click to replace"
        />
      ) : (
        <button
          type="button"
          onClick={() => !busy && fileRef.current?.click()}
          disabled={busy}
          title="Upload image"
          className="w-10 h-10 rounded border border-dashed border-slate-300 text-slate-400 grid place-items-center text-lg hover:border-brand hover:text-brand"
        >
          {busy ? '…' : '+'}
        </button>
      )}
    </div>
  );
}
