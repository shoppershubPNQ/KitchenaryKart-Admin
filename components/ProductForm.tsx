'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/fetch';

export interface ProductDraft {
  id?: number;
  sku: string;
  /** Auto-generated second identifier (e.g. "PID-00054"). Read-only. */
  productCode?: string | null;
  name: string;
  description?: string | null;
  category?: string | null;
  subcategory?: string | null;
  price: number;
  /** Hotelic Essentials cost price (purchase / manufacturing CTC). Internal. */
  costPrice?: number | null;
  mrp?: number | null;
  taxPercent?: number;
  dimensions?: string | null;
  power?: string | null;
  capacity?: string | null;
  weight?: string | null;
  stock?: number;
  reorderPoint?: number;
  hsnCode?: string | null;
  /** Hand-written Google result title. Blank = generated from the name. */
  metaTitle?: string | null;
  /** Hand-written Google snippet. Blank = generated from the description. */
  metaDescription?: string | null;
  status?: 'active' | 'draft' | 'discontinued';
  isBestseller?: boolean;
  isNewArrival?: boolean;
}

/** Length hint under a meta field. Google truncates a title around 60
 *  characters and a snippet around 160 — past that the tail is simply not
 *  shown, so the count is a real limit, not a style preference. */
function CharCount({ value, limit }: { value: string; limit: number }) {
  const n = value.trim().length;
  if (n === 0) {
    return <p className="mt-1 text-[11px] text-slate-400">Blank — the site generates this one.</p>;
  }
  const tone = n > limit ? 'text-red-600' : n > limit * 0.9 ? 'text-amber-600' : 'text-emerald-600';
  return (
    <p className={`mt-1 text-[11px] ${tone}`}>
      {n} / {limit} characters{n > limit ? ' — Google will cut the end off' : ''}
    </p>
  );
}

/** Trim to a word boundary, for the preview box only. */
function clampPreview(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.lastIndexOf(' ', limit);
  return clean.slice(0, cut > 0 ? cut : limit).trimEnd() + '…';
}

export function ProductForm({ initial, isNew }: { initial: ProductDraft; isNew: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<ProductDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function update<K extends keyof ProductDraft>(k: K, v: ProductDraft[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  // Prices are stored GST-INCLUSIVE (what the customer pays). The excl.-GST
  // figure and the GST amount are derived for the admin's convenience, and
  // typing an excl.-GST price fills the inclusive one. Nothing new is saved.
  const gstRate = Number(form.taxPercent ?? 18) || 0;
  const priceIncl = Number(form.price) || 0;
  const priceExcl = priceIncl / (1 + gstRate / 100);
  const gstAmount = priceIncl - priceExcl;
  // While the admin types in the excl.-GST box, show their text as typed
  // rather than the re-derived figure, so the cursor does not jump.
  const [exclDraft, setExclDraft] = useState<string | null>(null);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const rupees = (n: number) =>
    '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      // Strip empty strings + coerce numerics
      const payload: any = { ...form };
      for (const k of Object.keys(payload)) {
        if (payload[k] === '') payload[k] = null;
      }
      payload.price = Number(payload.price);
      if (payload.costPrice != null && payload.costPrice !== '') payload.costPrice = Number(payload.costPrice);
      if (payload.mrp != null && payload.mrp !== '') payload.mrp = Number(payload.mrp);
      if (payload.taxPercent != null && payload.taxPercent !== '') payload.taxPercent = Number(payload.taxPercent);
      if (payload.stock != null && payload.stock !== '') payload.stock = Number(payload.stock);
      if (payload.reorderPoint != null && payload.reorderPoint !== '') payload.reorderPoint = Number(payload.reorderPoint);

      delete payload.productCode; // auto-generated, never client-editable
      if (isNew) {
        await api('/api/products', { method: 'POST', body: JSON.stringify(payload) });
      } else {
        delete payload.sku; // SKU is immutable on update
        await api(`/api/products/${initial.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      }
      router.push('/dashboard/products');
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="card p-6 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">SKU</label>
          <input className="input" value={form.sku} onChange={e => update('sku', e.target.value)} required disabled={!isNew} />
        </div>
        <div>
          <label className="label">Product ID</label>
          <input
            className="input font-mono bg-slate-50 text-slate-500"
            value={form.productCode || (isNew ? 'Auto-assigned on save' : '—')}
            disabled
            readOnly
          />
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={form.status || 'active'} onChange={e => update('status', e.target.value as any)}>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="discontinued">Discontinued</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label">Name</label>
          <input className="input" value={form.name} onChange={e => update('name', e.target.value)} required />
        </div>
        <div className="md:col-span-2">
          <label className="label">Description</label>
          <textarea className="input" rows={3} value={form.description || ''} onChange={e => update('description', e.target.value)} />
        </div>
        <div>
          <label className="label">Category</label>
          <input className="input" value={form.category || ''} onChange={e => update('category', e.target.value)} />
        </div>
        <div>
          <label className="label">Subcategory</label>
          <input className="input" value={form.subcategory || ''} onChange={e => update('subcategory', e.target.value)} />
        </div>
      </div>

      <fieldset className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <legend className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2 col-span-full">Pricing & stock</legend>
        <div>
          <label className="label">Price incl. GST (₹)</label>
          <input type="number" step="0.01" className="input" value={form.price} onChange={e => update('price', parseFloat(e.target.value))} required />
          <p className="mt-1 text-[11px] text-slate-500">
            {priceIncl > 0
              ? <>Excl. GST {rupees(priceExcl)} + GST {gstRate}% {rupees(gstAmount)} = <strong>{rupees(priceIncl)}</strong></>
              : 'What the customer pays, GST included.'}
          </p>
        </div>
        <div>
          <label className="label">Price excl. GST (₹)</label>
          <input
            type="number"
            step="0.01"
            className="input"
            value={exclDraft ?? (priceIncl > 0 ? round2(priceExcl) : '')}
            placeholder="Type to fill the GST price"
            onChange={e => {
              setExclDraft(e.target.value);
              const ex = parseFloat(e.target.value);
              if (Number.isFinite(ex)) update('price', round2(ex * (1 + gstRate / 100)));
            }}
            onBlur={() => setExclDraft(null)}
          />
          <p className="mt-1 text-[11px] text-slate-400">Type here and the incl.-GST price fills itself.</p>
        </div>
        <div>
          <label className="label">Cost — Hotelic Essentials (₹)</label>
          <input
            type="number"
            step="0.01"
            className="input"
            value={form.costPrice ?? ''}
            onChange={e => update('costPrice', e.target.value ? parseFloat(e.target.value) : null)}
            placeholder="Purchase / mfg cost"
          />
          <p className="mt-1 text-[11px] text-slate-400">
            Internal only — never shown to customers.
            {form.costPrice != null && form.costPrice !== ('' as any) && Number(form.price) > 0 && (
              <span className="text-slate-500">
                {' '}Margin: ₹{(Number(form.price) - Number(form.costPrice)).toLocaleString('en-IN')}
                {' '}({(((Number(form.price) - Number(form.costPrice)) / Number(form.price)) * 100).toFixed(1)}%)
              </span>
            )}
          </p>
        </div>
        <div>
          <label className="label">MRP (₹)</label>
          <input type="number" step="0.01" className="input" value={form.mrp ?? ''} onChange={e => update('mrp', e.target.value ? parseFloat(e.target.value) : null)} />
        </div>
        <div>
          <label className="label">GST %</label>
          <input type="number" step="0.01" className="input" value={form.taxPercent ?? 18} onChange={e => update('taxPercent', parseFloat(e.target.value))} />
        </div>
        <div>
          <label className="label">HSN code</label>
          <input className="input" value={form.hsnCode || ''} onChange={e => update('hsnCode', e.target.value)} />
        </div>
        <div>
          <label className="label">Stock</label>
          <input type="number" className="input" value={form.stock ?? 0} onChange={e => update('stock', parseInt(e.target.value) || 0)} />
        </div>
        <div>
          <label className="label">Reorder point</label>
          <input type="number" className="input" value={form.reorderPoint ?? 5} onChange={e => update('reorderPoint', parseInt(e.target.value) || 0)} />
        </div>
      </fieldset>

      <fieldset className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <legend className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2 col-span-full">Specifications</legend>
        <div>
          <label className="label">Dimensions</label>
          <input className="input" value={form.dimensions || ''} onChange={e => update('dimensions', e.target.value)} />
        </div>
        <div>
          <label className="label">Power</label>
          <input className="input" value={form.power || ''} onChange={e => update('power', e.target.value)} />
        </div>
        <div>
          <label className="label">Capacity</label>
          <input className="input" value={form.capacity || ''} onChange={e => update('capacity', e.target.value)} />
        </div>
        <div>
          <label className="label">Weight</label>
          <input className="input" value={form.weight || ''} onChange={e => update('weight', e.target.value)} />
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">
          Search engine listing
        </legend>
        <p className="-mt-1 text-[11px] leading-relaxed text-slate-500">
          Leave these blank and the site writes them itself from the product name and description —
          that is what every product does today. Fill them in for the handful of products that
          actually bring search traffic; writing them for everything is not worth the effort.
          The title is what people click in Google. The description does not affect ranking
          (Google often rewrites it), it only affects whether the result gets clicked.
        </p>

        <div>
          <label className="label">Meta title</label>
          <input
            className="input"
            value={form.metaTitle || ''}
            onChange={(e) => update('metaTitle', e.target.value)}
            placeholder={form.name ? `${form.name.slice(0, 45)} | Kitchenary Kart` : 'Auto-generated from the product name'}
          />
          <CharCount value={form.metaTitle || ''} limit={60} />
        </div>

        <div>
          <label className="label">Meta description</label>
          <textarea
            className="input"
            rows={3}
            value={form.metaDescription || ''}
            onChange={(e) => update('metaDescription', e.target.value)}
            placeholder="Auto-generated from the product description"
          />
          <CharCount value={form.metaDescription || ''} limit={160} />
        </div>

        {/* What the result is shaped like in Google. Only the lengths and
            truncation are real — Google decides the final wording itself. */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Roughly how Google would show it
          </div>
          <div className="text-xs text-slate-600">
            kitchenarykart.com › product › {form.sku || 'SKU'}
          </div>
          <div className="mt-0.5 truncate text-[18px] leading-snug text-[#1a0dab]">
            {form.metaTitle?.trim() || (form.name ? `${form.name} | Kitchenary Kart` : 'Product title')}
          </div>
          <div className="mt-0.5 text-[13px] leading-snug text-slate-700">
            {clampPreview(form.metaDescription?.trim() || form.description?.trim() || '', 160) ||
              'The description shown here comes from the product description when this is blank.'}
          </div>
        </div>
      </fieldset>

      <fieldset className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <legend className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2 col-span-full">
          Merchandising
        </legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!form.isBestseller}
            onChange={(e) => update('isBestseller', e.target.checked)}
          />
          <span>Feature on home page as <strong>Best Seller</strong></span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!form.isNewArrival}
            onChange={(e) => update('isNewArrival', e.target.checked)}
          />
          <span>Feature on home page as <strong>New Arrival</strong></span>
        </label>
      </fieldset>

      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}

      <div className="flex gap-3">
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save product'}</button>
        <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
