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
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/fetch';

interface Variant {
  id: number;
  productId: number;
  variantType: string | null;
  variantValue: string | null;
  skuSuffix: string | null;
  priceModifier: number | string;
  /** Absolute selling price (GST-incl). Preferred over priceModifier. */
  price: number | string | null;
  /** Absolute MRP (sticker) — drives the strike-through + SAVE %. */
  mrp: number | string | null;
  stock: number;
  imageUrl: string | null;
  images?: string[] | null;
}

interface Draft {
  variantType: string;
  variantValue: string;
  skuSuffix: string;
  price: string;
  mrp: string;
  stock: string;
}

const EMPTY_DRAFT: Draft = {
  variantType: '',
  variantValue: '',
  skuSuffix: '',
  price: '',
  mrp: '',
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
          price: draft.price.trim() === '' ? null : Number(draft.price),
          mrp: draft.mrp.trim() === '' ? null : Number(draft.mrp),
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
              <Th>Image</Th>
              <Th>Type</Th>
              <Th>Value</Th>
              <Th>SKU suffix</Th>
              <Th align="right">Price ₹</Th>
              <Th align="right">MRP ₹</Th>
              <Th align="right">Stock</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={8} className="p-4 text-center text-slate-400">Loading…</td></tr>
            )}
            {!loading && variants.length === 0 && (
              <tr><td colSpan={8} className="p-4 text-center text-slate-400">No variants yet.</td></tr>
            )}
            {variants.map((v) => (
              <tr key={v.id} className="hover:bg-slate-50">
                <td className="px-2 py-1.5">
                  <VariantImageCell
                    variant={v}
                    onChange={(next) =>
                      setVariants((prev) =>
                        prev.map((x) =>
                          x.id === v.id ? { ...x, imageUrl: next.imageUrl, images: next.images } : x,
                        ),
                      )
                    }
                  />
                </td>
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
                    defaultValue={v.price == null ? '' : Number(v.price)}
                    placeholder="0.00"
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      const next = raw === '' ? null : Number(raw);
                      if (next !== (v.price == null ? null : Number(v.price))) update(v, 'price', next);
                    }}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    step="0.01"
                    className="input input-sm w-full text-right"
                    defaultValue={v.mrp == null ? '' : Number(v.mrp)}
                    placeholder="—"
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      const next = raw === '' ? null : Number(raw);
                      if (next !== (v.mrp == null ? null : Number(v.mrp))) update(v, 'mrp', next);
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
            placeholder="Price ₹"
            value={draft.price}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
          />
          <input
            type="number"
            step="0.01"
            className="input input-sm md:col-span-1 text-right"
            placeholder="MRP ₹"
            value={draft.mrp}
            onChange={(e) => setDraft({ ...draft, mrp: e.target.value })}
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

/**
 * Mini-gallery cell embedded in each variant row.
 *
 * - First slot = primary thumbnail (the imageUrl). Hover for × to remove.
 *   Click to expand the gallery.
 * - Expanded view = horizontal strip of all variant images + a "+"
 *   tile to add more. Click any image to make it primary, hover for ×
 *   to remove. Click outside (or press the chevron) to collapse.
 *
 * Multi-file picker — admin can drop 3 photos at once and they all
 * upload in a single POST (form field `files`). Files append to
 * the variant's images array; imageUrl is set to the first if blank.
 */
function VariantImageCell({
  variant,
  onChange,
}: {
  variant: Variant;
  onChange: (next: { imageUrl: string | null; images: string[] }) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const images = variant.images ?? [];
  const primary = variant.imageUrl;

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErr(null);
    setBusy(true);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append('files', f);
      const res = await fetch(`/api/variants/${variant.id}/image`, {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      onChange({ imageUrl: data.imageUrl, images: data.images || [] });
      // Auto-expand after first upload so the new images are visible
      if ((data.images || []).length > 1) setExpanded(true);
    } catch (e: any) {
      setErr(e.message || 'Upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeOne(url: string) {
    if (!confirm('Remove this image?')) return;
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/variants/${variant.id}/image`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Remove failed');
      onChange({ imageUrl: data.imageUrl, images: data.images || [] });
    } catch (e: any) {
      setErr(e.message || 'Remove failed');
    } finally {
      setBusy(false);
    }
  }

  async function setAsPrimary(url: string) {
    setErr(null);
    setBusy(true);
    try {
      const reordered = [url, ...images.filter((u) => u !== url)];
      const res = await fetch(`/api/variants/${variant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      onChange({ imageUrl: url, images: reordered });
    } catch (e: any) {
      setErr(e.message || 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  // Empty state — no images yet
  if (!primary && images.length === 0) {
    return (
      <div className="relative w-12 h-12">
        <input
          ref={fileRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.gif"
          multiple
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
        <button
          type="button"
          onClick={() => !busy && fileRef.current?.click()}
          disabled={busy}
          title="Upload variant images (multi-select supported)"
          className="w-12 h-12 rounded border border-dashed border-slate-300 text-slate-400 grid place-items-center text-xl hover:border-brand hover:text-brand disabled:opacity-50"
        >
          {busy ? '…' : '+'}
        </button>
        {err && (
          <div className="absolute top-full left-0 mt-1 text-[10px] text-red-600 whitespace-nowrap z-10 bg-white border border-red-200 rounded px-1.5 py-0.5">
            {err}
          </div>
        )}
      </div>
    );
  }

  // Collapsed view: just the primary, with a counter badge if multiple
  if (!expanded) {
    return (
      <div className="relative w-12 h-12">
        <input
          ref={fileRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.gif"
          multiple
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
        <div className="relative w-12 h-12 rounded border border-slate-200 bg-slate-50 overflow-hidden group">
          {primary && (
            <img
              src={primary}
              alt=""
              className="w-full h-full object-contain cursor-pointer"
              onClick={() => setExpanded(true)}
              title={`Click to manage ${images.length || 1} image${(images.length || 1) === 1 ? '' : 's'}`}
            />
          )}
          {images.length > 1 && (
            <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] font-semibold text-center py-0.5 leading-none pointer-events-none">
              {images.length}
            </span>
          )}
        </div>
        {err && (
          <div className="absolute top-full left-0 mt-1 text-[10px] text-red-600 whitespace-nowrap z-10 bg-white border border-red-200 rounded px-1.5 py-0.5">
            {err}
          </div>
        )}
      </div>
    );
  }

  // Expanded view: horizontal strip of all images + add tile
  return (
    <div className="relative">
      <input
        ref={fileRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.gif"
        multiple
        className="hidden"
        onChange={(e) => upload(e.target.files)}
      />
      <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-md p-1.5 shadow-sm">
        {images.map((u) => {
          const isPrimary = u === primary;
          return (
            <div
              key={u}
              className={`relative w-12 h-12 rounded overflow-hidden border-2 group ${
                isPrimary ? 'border-brand' : 'border-slate-200'
              }`}
            >
              <img
                src={u}
                alt=""
                className="w-full h-full object-contain bg-slate-50 cursor-pointer"
                onClick={() => !isPrimary && !busy && setAsPrimary(u)}
                title={isPrimary ? 'Primary image' : 'Click to set as primary'}
              />
              {isPrimary && (
                <span className="absolute top-0 left-0 bg-brand text-white text-[8px] font-bold px-1 leading-tight">
                  MAIN
                </span>
              )}
              <button
                type="button"
                onClick={() => removeOne(u)}
                disabled={busy}
                aria-label="Remove image"
                className="absolute top-0 right-0 w-4 h-4 grid place-items-center rounded-bl bg-red-600 text-white text-[10px] leading-none opacity-0 group-hover:opacity-100 hover:bg-red-700 disabled:opacity-30"
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => !busy && fileRef.current?.click()}
          disabled={busy}
          title="Add image(s) — multi-select supported"
          className="w-12 h-12 rounded border border-dashed border-slate-300 text-slate-400 grid place-items-center text-xl hover:border-brand hover:text-brand disabled:opacity-50 shrink-0"
        >
          {busy ? '…' : '+'}
        </button>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label="Collapse"
          title="Collapse"
          className="w-6 h-6 grid place-items-center text-slate-400 hover:text-ink text-sm ml-1"
        >
          ‹
        </button>
      </div>
      {err && (
        <div className="absolute top-full left-0 mt-1 text-[10px] text-red-600 whitespace-nowrap z-10 bg-white border border-red-200 rounded px-1.5 py-0.5">
          {err}
        </div>
      )}
    </div>
  );
}
