'use client';

/**
 * Variant editor — embedded on the product edit page. Lists existing variants
 * for the product, lets the admin add new rows inline, edit any field in
 * place, and delete rows.
 *
 * "Multi-variation" works by adding several rows on the same product —
 * Size: Small, Size: Medium, Color: Red, etc. Each row is one (type, value)
 * pair with its own SKU suffix, price modifier, and stock.
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/fetch';

interface Variant {
  id: number;
  productId: number;
  variantType: string | null;
  variantValue: string | null;
  skuSuffix: string | null;
  priceModifier: number | string;
  stock: number;
}

interface Draft {
  variantType: string;
  variantValue: string;
  skuSuffix: string;
  priceModifier: string;
  stock: string;
}

const EMPTY_DRAFT: Draft = {
  variantType: '',
  variantValue: '',
  skuSuffix: '',
  priceModifier: '0',
  stock: '0',
};

export function ProductVariants({ productId }: { productId: number }) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api<{ variants: Variant[] }>(`/api/products/${productId}/variants`);
      setVariants(data.variants);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  async function addVariant() {
    setErr(null);
    if (!draft.variantType.trim() || !draft.variantValue.trim()) {
      setErr('Both type and value are required.');
      return;
    }
    setCreating(true);
    try {
      await api(`/api/products/${productId}/variants`, {
        method: 'POST',
        body: JSON.stringify({
          variantType: draft.variantType.trim(),
          variantValue: draft.variantValue.trim(),
          skuSuffix: draft.skuSuffix.trim() || null,
          priceModifier: Number(draft.priceModifier) || 0,
          stock: Math.trunc(Number(draft.stock) || 0),
        }),
      });
      setDraft(EMPTY_DRAFT);
      load();
    } catch (e: any) {
      setErr(e?.message || 'Could not create variant');
    } finally {
      setCreating(false);
    }
  }

  async function update<K extends keyof Variant>(v: Variant, key: K, value: Variant[K]) {
    setVariants((prev) => prev.map((x) => (x.id === v.id ? { ...x, [key]: value } : x)));
    try {
      await api(`/api/variants/${v.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [key]: value }),
      });
    } catch {
      // revert
      setVariants((prev) => prev.map((x) => (x.id === v.id ? { ...x, [key]: v[key] } : x)));
      alert('Could not update. Retry?');
    }
  }

  async function remove(id: number) {
    if (!confirm('Remove this variant?')) return;
    await api(`/api/variants/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Variants</h3>
          <p className="text-xs text-slate-500 mt-1">
            Add one row per option (e.g. Size: Small, Size: Medium, Color: Red).
            Multiple types are supported on a single product.
          </p>
        </div>
        <a href="/dashboard/variants/import" className="text-xs text-brand hover:underline">
          Bulk import →
        </a>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-y border-slate-200">
            <tr>
              <Th>Type</Th>
              <Th>Value</Th>
              <Th>SKU suffix</Th>
              <Th align="right">Price &Delta;</Th>
              <Th align="right">Stock</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={6} className="p-4 text-center text-slate-400">Loading…</td></tr>
            )}
            {!loading && variants.length === 0 && (
              <tr><td colSpan={6} className="p-4 text-center text-slate-400">No variants yet.</td></tr>
            )}
            {variants.map((v) => (
              <tr key={v.id} className="hover:bg-slate-50">
                <td className="px-2 py-1.5">
                  <input
                    className="input input-sm w-full"
                    defaultValue={v.variantType ?? ''}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (next && next !== v.variantType) update(v, 'variantType', next);
                    }}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    className="input input-sm w-full"
                    defaultValue={v.variantValue ?? ''}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (next && next !== v.variantValue) update(v, 'variantValue', next);
                    }}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    className="input input-sm w-full"
                    defaultValue={v.skuSuffix ?? ''}
                    placeholder="e.g. -S"
                    onBlur={(e) => {
                      const next = e.target.value.trim() || null;
                      if (next !== v.skuSuffix) update(v, 'skuSuffix', next);
                    }}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    step="0.01"
                    className="input input-sm w-full text-right"
                    defaultValue={Number(v.priceModifier)}
                    onBlur={(e) => {
                      const next = Number(e.target.value) || 0;
                      if (next !== Number(v.priceModifier)) update(v, 'priceModifier', next);
                    }}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    className="input input-sm w-full text-right"
                    defaultValue={v.stock}
                    onBlur={(e) => {
                      const next = Math.trunc(Number(e.target.value) || 0);
                      if (next !== v.stock) update(v, 'stock', next);
                    }}
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button onClick={() => remove(v.id)} className="text-xs text-red-600 hover:underline">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Inline add form */}
      <div className="border border-dashed border-slate-300 rounded-md p-3">
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Add variant</div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <input
            className="input input-sm md:col-span-1"
            placeholder="Type (e.g. Size)"
            value={draft.variantType}
            onChange={(e) => setDraft({ ...draft, variantType: e.target.value })}
          />
          <input
            className="input input-sm md:col-span-1"
            placeholder="Value (e.g. Small)"
            value={draft.variantValue}
            onChange={(e) => setDraft({ ...draft, variantValue: e.target.value })}
          />
          <input
            className="input input-sm md:col-span-1"
            placeholder="SKU suffix"
            value={draft.skuSuffix}
            onChange={(e) => setDraft({ ...draft, skuSuffix: e.target.value })}
          />
          <input
            type="number"
            step="0.01"
            className="input input-sm md:col-span-1 text-right"
            placeholder="Price ±"
            value={draft.priceModifier}
            onChange={(e) => setDraft({ ...draft, priceModifier: e.target.value })}
          />
          <input
            type="number"
            className="input input-sm md:col-span-1 text-right"
            placeholder="Stock"
            value={draft.stock}
            onChange={(e) => setDraft({ ...draft, stock: e.target.value })}
          />
          <button
            type="button"
            onClick={addVariant}
            disabled={creating}
            className="btn-primary md:col-span-1 text-sm"
          >
            {creating ? 'Adding…' : '+ Add'}
          </button>
        </div>
        {err && <div className="text-sm text-red-600 mt-2">{err}</div>}
      </div>
    </div>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className={`px-2 py-2 text-[11px] font-medium text-slate-500 uppercase tracking-wide text-${align}`}
    >
      {children}
    </th>
  );
}
