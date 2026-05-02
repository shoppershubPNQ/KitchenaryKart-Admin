'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/fetch';

export interface CustomerDraft {
  id?: number;
  name: string;
  email: string;
  phone?: string | null;
  companyName?: string | null;
  customerType?: 'retail' | 'b2b' | 'corporate';
  billingAddress?: string | null;
  shippingAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  gstNumber?: string | null;
  creditLimit?: number;
}

export function CustomerForm({ initial, isNew }: { initial: CustomerDraft; isNew: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<CustomerDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function update<K extends keyof CustomerDraft>(k: K, v: CustomerDraft[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      const payload: any = { ...form };
      for (const k of Object.keys(payload)) if (payload[k] === '') payload[k] = null;
      if (payload.creditLimit != null && payload.creditLimit !== '') payload.creditLimit = Number(payload.creditLimit);
      if (isNew) {
        await api('/api/customers', { method: 'POST', body: JSON.stringify(payload) });
      } else {
        delete payload.email;
        await api(`/api/customers/${initial.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      }
      router.push('/dashboard/customers');
      router.refresh();
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="card p-6 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><label className="label">Name</label><input className="input" value={form.name} onChange={e => update('name', e.target.value)} required /></div>
        <div><label className="label">Email</label><input type="email" className="input" value={form.email} onChange={e => update('email', e.target.value)} required disabled={!isNew} /></div>
        <div><label className="label">Phone</label><input className="input" value={form.phone || ''} onChange={e => update('phone', e.target.value)} /></div>
        <div><label className="label">Type</label>
          <select className="input" value={form.customerType || 'retail'} onChange={e => update('customerType', e.target.value as any)}>
            <option value="retail">Retail</option><option value="b2b">B2B</option><option value="corporate">Corporate</option>
          </select>
        </div>
        <div><label className="label">Company name</label><input className="input" value={form.companyName || ''} onChange={e => update('companyName', e.target.value)} /></div>
        <div><label className="label">GSTIN</label><input className="input" value={form.gstNumber || ''} onChange={e => update('gstNumber', e.target.value)} /></div>
        <div className="md:col-span-2"><label className="label">Billing address</label><textarea className="input" rows={2} value={form.billingAddress || ''} onChange={e => update('billingAddress', e.target.value)} /></div>
        <div className="md:col-span-2"><label className="label">Shipping address</label><textarea className="input" rows={2} value={form.shippingAddress || ''} onChange={e => update('shippingAddress', e.target.value)} /></div>
        <div><label className="label">City</label><input className="input" value={form.city || ''} onChange={e => update('city', e.target.value)} /></div>
        <div><label className="label">State</label><input className="input" value={form.state || ''} onChange={e => update('state', e.target.value)} /></div>
        <div><label className="label">Postal code</label><input className="input" value={form.postalCode || ''} onChange={e => update('postalCode', e.target.value)} /></div>
        <div><label className="label">Country</label><input className="input" value={form.country || 'India'} onChange={e => update('country', e.target.value)} /></div>
        <div><label className="label">Credit limit (₹)</label><input type="number" step="0.01" className="input" value={form.creditLimit ?? 0} onChange={e => update('creditLimit', parseFloat(e.target.value) || 0)} /></div>
      </div>

      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}

      <div className="flex gap-3">
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
