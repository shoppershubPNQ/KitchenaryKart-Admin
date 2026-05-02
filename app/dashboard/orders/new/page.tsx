'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, inr } from '@/lib/fetch';

interface Product { id: number; sku: string; name: string; price: number }
interface Line { productId: number; sku: string; name: string; unitPrice: number; quantity: number }

export default function NewOrderPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [customer, setCustomer] = useState({ name: '', email: '', phone: '', address: '' });
  const [shippingCost, setShippingCost] = useState(0);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      if (query.length < 2) { setProducts([]); return; }
      api<{ products: Product[] }>('/api/products?search=' + encodeURIComponent(query) + '&limit=15').then(d => setProducts(d.products));
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  function addLine(p: Product) {
    setLines(prev => {
      const existing = prev.find(l => l.productId === p.id);
      if (existing) return prev.map(l => l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l);
      return [...prev, { productId: p.id, sku: p.sku, name: p.name, unitPrice: Number(p.price), quantity: 1 }];
    });
    setQuery('');
    setProducts([]);
  }
  function setQty(id: number, q: number) {
    setLines(prev => prev.map(l => l.productId === id ? { ...l, quantity: Math.max(1, q) } : l));
  }
  function removeLine(id: number) { setLines(prev => prev.filter(l => l.productId !== id)); }

  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!lines.length) { setErr('Add at least one item'); return; }
    setErr(null);
    setSaving(true);
    try {
      const payload = {
        customerName: customer.name,
        customerEmail: customer.email || undefined,
        customerPhone: customer.phone,
        shippingAddress: customer.address,
        shippingCost,
        items: lines.map(l => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })),
      };
      const { order } = await api<{ order: { id: number } }>('/api/orders', { method: 'POST', body: JSON.stringify(payload) });
      router.push(`/dashboard/orders/${order.id}`);
    } catch (e: any) {
      setErr(e.message);
    } finally { setSaving(false); }
  }

  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Manual order</h1>

      <form onSubmit={submit} className="card p-6 space-y-6">
        <fieldset className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <legend className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2 col-span-full">Customer</legend>
          <div><label className="label">Name</label><input className="input" value={customer.name} onChange={e => setCustomer(c => ({ ...c, name: e.target.value }))} required /></div>
          <div><label className="label">Email</label><input type="email" className="input" value={customer.email} onChange={e => setCustomer(c => ({ ...c, email: e.target.value }))} /></div>
          <div><label className="label">Phone</label><input className="input" value={customer.phone} onChange={e => setCustomer(c => ({ ...c, phone: e.target.value }))} /></div>
          <div><label className="label">Shipping cost</label><input type="number" step="0.01" className="input" value={shippingCost} onChange={e => setShippingCost(parseFloat(e.target.value) || 0)} /></div>
          <div className="md:col-span-2"><label className="label">Shipping address</label><textarea className="input" rows={2} value={customer.address} onChange={e => setCustomer(c => ({ ...c, address: e.target.value }))} /></div>
        </fieldset>

        <div>
          <label className="label">Add product</label>
          <input className="input" placeholder="Type SKU or name…" value={query} onChange={e => setQuery(e.target.value)} />
          {products.length > 0 && (
            <ul className="mt-1 border border-slate-200 rounded-md shadow-sm bg-white max-h-64 overflow-y-auto">
              {products.map(p => (
                <li key={p.id}>
                  <button type="button" className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm" onClick={() => addLine(p)}>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-slate-500 font-mono">{p.sku} · {inr(p.price)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {lines.length > 0 && (
          <div>
            <div className="label">Line items</div>
            <table className="w-full text-sm border border-slate-200 rounded-md">
              <thead className="bg-slate-50 text-xs">
                <tr><th className="text-left px-3 py-2">Item</th><th className="text-right px-3 py-2">Unit</th><th className="px-3 py-2">Qty</th><th className="text-right px-3 py-2">Total</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map(l => (
                  <tr key={l.productId}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{l.name}</div>
                      <div className="font-mono text-xs text-slate-500">{l.sku}</div>
                    </td>
                    <td className="px-3 py-2 text-right">{inr(l.unitPrice)}</td>
                    <td className="px-3 py-2 text-center">
                      <input type="number" min={1} className="input w-20 text-center" value={l.quantity} onChange={e => setQty(l.productId, parseInt(e.target.value))} />
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{inr(l.unitPrice * l.quantity)}</td>
                    <td className="px-3 py-2 text-right"><button type="button" onClick={() => removeLine(l.productId)} className="text-red-600 text-xs hover:underline">Remove</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 text-sm">
                <tr><td colSpan={3} className="px-3 py-2 text-right text-slate-500">Subtotal</td><td className="px-3 py-2 text-right font-semibold">{inr(subtotal)}</td><td></td></tr>
              </tfoot>
            </table>
            <p className="text-xs text-slate-500 mt-2">GST is calculated per line on save.</p>
          </div>
        )}

        {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create order'}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
