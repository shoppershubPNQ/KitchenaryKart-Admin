'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, dateShort } from '@/lib/fetch';

interface LowStock { id: number; sku: string; name: string; category: string | null; stock: number; reorderPoint: number; unitsNeeded: number }
interface Movement {
  id: number; quantity: number; movementType: string; notes: string | null; createdAt: string;
  product: { sku: string; name: string } | null;
}

export default function InventoryPage() {
  const [lowStock, setLowStock] = useState<LowStock[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        api<{ items: LowStock[] }>('/api/inventory/low-stock'),
        api<{ movements: Movement[] }>('/api/inventory'),
      ]);
      setLowStock(a.items);
      setMovements(b.movements);
    } finally { setLoading(false); }
  }

  useEffect(() => { loadAll(); }, []);

  async function adjust(productId: number) {
    const qtyStr = prompt('Enter adjustment quantity (positive = stock in, negative = stock out):');
    if (!qtyStr) return;
    const qty = parseInt(qtyStr);
    if (!Number.isFinite(qty)) return alert('Invalid number');
    const notes = prompt('Notes (optional):') || undefined;
    const movementType = qty >= 0 ? 'stock_in' : 'stock_out';
    await api('/api/inventory', {
      method: 'POST',
      body: JSON.stringify({ productId, quantity: Math.abs(qty), movementType, notes }),
    });
    loadAll();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Inventory</h1>

      <section className="card">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-semibold">Low-stock alerts</h2>
          <span className="pill-red">{lowStock.length}</span>
        </div>
        {loading && <div className="p-8 text-center text-slate-400">Loading…</div>}
        {!loading && lowStock.length === 0 && <div className="p-8 text-center text-slate-400">Nothing below reorder point. </div>}
        {!loading && lowStock.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr><th className="px-4 py-2 text-left">SKU</th><th className="px-4 py-2 text-left">Name</th><th className="px-4 py-2 text-left">Category</th><th className="px-4 py-2 text-right">Stock</th><th className="px-4 py-2 text-right">Reorder</th><th className="px-4 py-2 text-right">Needed</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lowStock.map(i => (
                <tr key={i.id}>
                  <td className="px-4 py-2 font-mono text-xs">{i.sku}</td>
                  <td className="px-4 py-2"><Link href={`/dashboard/products/${i.id}`} className="text-slate-900 hover:text-brand">{i.name}</Link></td>
                  <td className="px-4 py-2 text-slate-600">{i.category || '—'}</td>
                  <td className="px-4 py-2 text-right"><span className="pill-red">{i.stock}</span></td>
                  <td className="px-4 py-2 text-right text-slate-500">{i.reorderPoint}</td>
                  <td className="px-4 py-2 text-right font-medium">{i.unitsNeeded}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => adjust(i.id)} className="text-xs text-brand hover:underline">Adjust stock</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <div className="px-4 py-3 border-b border-slate-200 font-semibold">Recent stock movements</div>
        {movements.length === 0 && <div className="p-8 text-center text-slate-400">No movements recorded yet.</div>}
        {movements.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr><th className="px-4 py-2 text-left">Date</th><th className="px-4 py-2 text-left">Type</th><th className="px-4 py-2 text-left">Product</th><th className="px-4 py-2 text-right">Qty</th><th className="px-4 py-2 text-left">Notes</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {movements.map(m => (
                <tr key={m.id}>
                  <td className="px-4 py-2 text-slate-500">{dateShort(m.createdAt)}</td>
                  <td className="px-4 py-2"><span className={m.movementType === 'stock_in' ? 'pill-green' : m.movementType === 'stock_out' ? 'pill-yellow' : 'pill-gray'}>{m.movementType.replace('_', ' ')}</span></td>
                  <td className="px-4 py-2">
                    {m.product ? <><span className="font-medium">{m.product.name}</span><span className="text-xs text-slate-500 ml-2 font-mono">{m.product.sku}</span></> : '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-medium">{m.quantity}</td>
                  <td className="px-4 py-2 text-slate-600">{m.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
