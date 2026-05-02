'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/fetch';

export interface ProductDraft {
  id?: number;
  sku: string;
  name: string;
  description?: string | null;
  category?: string | null;
  subcategory?: string | null;
  price: number;
  mrp?: number | null;
  taxPercent?: number;
  dimensions?: string | null;
  power?: string | null;
  capacity?: string | null;
  weight?: string | null;
  stock?: number;
  reorderPoint?: number;
  hsnCode?: string | null;
  status?: 'active' | 'draft' | 'discontinued';
  isBestseller?: boolean;
  isNewArrival?: boolean;
}

export function ProductForm({ initial, isNew }: { initial: ProductDraft; isNew: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<ProductDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function update<K extends keyof ProductDraft>(k: K, v: ProductDraft[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

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
      if (payload.mrp != null && payload.mrp !== '') payload.mrp = Number(payload.mrp);
      if (payload.taxPercent != null && payload.taxPercent !== '') payload.taxPercent = Number(payload.taxPercent);
      if (payload.stock != null && payload.stock !== '') payload.stock = Number(payload.stock);
      if (payload.reorderPoint != null && payload.reorderPoint !== '') payload.reorderPoint = Number(payload.reorderPoint);

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
          <label className="label">Price (₹)</label>
          <input type="number" step="0.01" className="input" value={form.price} onChange={e => update('price', parseFloat(e.target.value))} required />
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
