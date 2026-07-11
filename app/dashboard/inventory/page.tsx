'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, dateShort } from '@/lib/fetch';

const IMG_BASE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:5500';
function imgSrc(url: string | null): string | null {
  if (!url) return null;
  if (/^https?:/i.test(url)) return url;
  return IMG_BASE + url;
}

interface Product {
  id: number; sku: string; name: string; category: string | null;
  subcategory: string | null; stock: number; reorderPoint: number; imageUrl: string | null;
}
interface LowStock {
  id: number; sku: string; name: string; category: string | null;
  stock: number; reorderPoint: number; unitsNeeded: number;
}
interface Movement {
  id: number; quantity: number; movementType: string; notes: string | null; createdAt: string;
  product: { sku: string; name: string } | null;
}

type Tab = 'products' | 'out' | 'movements';
const PAGE_SIZE = 20;

export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>('products');

  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(true);

  const [lowStock, setLowStock] = useState<LowStock[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);

  // Product being adjusted in the modal (name + current stock for context).
  const [adjust, setAdjust] = useState<{ id: number; name: string; stock: number } | null>(null);

  async function loadProducts() {
    setLoadingProducts(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (search.trim()) params.set('search', search.trim());
      const res = await api<{ products: Product[]; total: number }>(`/api/products?${params}`);
      setProducts(res.products);
      setTotal(res.total);
    } finally { setLoadingProducts(false); }
  }

  async function loadStockViews() {
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

  // Debounced product search / pagination.
  useEffect(() => {
    const t = setTimeout(loadProducts, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search]);

  useEffect(() => { loadStockViews(); }, []);

  function refreshAll() {
    loadProducts();
    loadStockViews();
  }

  const outCount = lowStock.length;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-slate-900">Inventory</h1>

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-1">
        <TabButton active={tab === 'products'} onClick={() => setTab('products')} label="Products" count={total} />
        <TabButton active={tab === 'out'} onClick={() => setTab('out')} label="Out of stock" count={outCount} danger />
        <TabButton active={tab === 'movements'} onClick={() => setTab('movements')} label="Recent stock movements" />
      </div>

      {/* PRODUCTS TAB */}
      {tab === 'products' && (
        <section className="card">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3">
            <input
              className="input max-w-xs"
              placeholder="Search by name or SKU…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
            />
            <span className="text-xs text-slate-400 ml-auto">{total} product{total === 1 ? '' : 's'}</span>
          </div>
          {loadingProducts && <div className="p-8 text-center text-slate-400">Loading…</div>}
          {!loadingProducts && products.length === 0 && (
            <div className="p-8 text-center text-slate-400">No products found.</div>
          )}
          {!loadingProducts && products.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Product</th>
                  <th className="px-4 py-2 text-left">Category</th>
                  <th className="px-4 py-2 text-right">Stock</th>
                  <th className="px-4 py-2 text-right">Reorder</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map(p => (
                  <tr key={p.id}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        {imgSrc(p.imageUrl) ? (
                          <img src={imgSrc(p.imageUrl)!} alt="" className="w-10 h-10 object-contain bg-slate-50 rounded-md border border-slate-100 shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded-md bg-slate-100 border border-slate-100 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <Link href={`/dashboard/products/${p.id}`} className="text-slate-900 hover:text-brand font-medium block truncate">{p.name}</Link>
                          <span className="text-[11px] text-slate-400 font-mono">{p.sku}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{p.category || '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={p.stock <= 0 ? 'pill-red' : p.stock <= p.reorderPoint ? 'pill-yellow' : 'pill-green'}>{p.stock}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{p.reorderPoint}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => setAdjust({ id: p.id, name: p.name, stock: p.stock })} className="text-xs text-brand hover:underline whitespace-nowrap">Add / remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {total > PAGE_SIZE && (
            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-sm">
              <button className="btn-outline disabled:opacity-40" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</button>
              <span className="text-slate-500">Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}</span>
              <button className="btn-outline disabled:opacity-40" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </section>
      )}

      {/* OUT OF STOCK TAB */}
      {tab === 'out' && (
        <section className="card">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-semibold">Out of stock &amp; low stock</h2>
            <span className="pill-red">{outCount}</span>
          </div>
          {loading && <div className="p-8 text-center text-slate-400">Loading…</div>}
          {!loading && lowStock.length === 0 && <div className="p-8 text-center text-slate-400">Everything is above its reorder point. 🎉</div>}
          {!loading && lowStock.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">SKU</th>
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-left">Category</th>
                  <th className="px-4 py-2 text-right">Stock</th>
                  <th className="px-4 py-2 text-right">Reorder</th>
                  <th className="px-4 py-2 text-right">Needed</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lowStock.map(i => (
                  <tr key={i.id}>
                    <td className="px-4 py-2 font-mono text-xs">{i.sku}</td>
                    <td className="px-4 py-2"><Link href={`/dashboard/products/${i.id}`} className="text-slate-900 hover:text-brand">{i.name}</Link></td>
                    <td className="px-4 py-2 text-slate-600">{i.category || '—'}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={i.stock <= 0 ? 'pill-red' : 'pill-yellow'}>{i.stock <= 0 ? 'Out' : i.stock}</span>
                    </td>
                    <td className="px-4 py-2 text-right text-slate-500">{i.reorderPoint}</td>
                    <td className="px-4 py-2 text-right font-medium">{i.unitsNeeded}</td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => setAdjust({ id: i.id, name: i.name, stock: i.stock })} className="text-xs text-brand hover:underline whitespace-nowrap">Add / remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* MOVEMENTS TAB */}
      {tab === 'movements' && (
        <section className="card">
          <div className="px-4 py-3 border-b border-slate-200 font-semibold">Recent stock movements</div>
          {loading && <div className="p-8 text-center text-slate-400">Loading…</div>}
          {!loading && movements.length === 0 && <div className="p-8 text-center text-slate-400">No movements recorded yet.</div>}
          {!loading && movements.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-left">Product</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-left">Notes</th>
                </tr>
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
      )}

      {adjust && (
        <AdjustModal
          product={adjust}
          onClose={() => setAdjust(null)}
          onSaved={() => { setAdjust(null); refreshAll(); }}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, label, count, danger }: { active: boolean; onClick: () => void; label: string; count?: number; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
        active ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-800'
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className={`ml-2 ${danger ? 'pill-red' : 'pill-gray'}`}>{count}</span>
      )}
    </button>
  );
}

function AdjustModal({ product, onClose, onSaved }: {
  product: { id: number; name: string; stock: number };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<'stock_in' | 'stock_out'>('stock_in');
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quantity = parseInt(qty, 10);
  const valid = Number.isFinite(quantity) && quantity > 0;
  const resulting = mode === 'stock_in' ? product.stock + (quantity || 0) : product.stock - (quantity || 0);

  async function save() {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await api('/api/inventory', {
        method: 'POST',
        body: JSON.stringify({ productId: product.id, quantity, movementType: mode, notes: notes || undefined }),
      });
      onSaved();
    } catch (e: any) {
      setError(e.message || 'Failed to save');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div>
          <h3 className="font-semibold text-slate-900">Adjust stock</h3>
          <p className="text-sm text-slate-500 truncate">{product.name}</p>
          <p className="text-xs text-slate-400 mt-1">Current stock: <span className="font-medium text-slate-700">{product.stock}</span></p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode('stock_in')}
            className={`btn ${mode === 'stock_in' ? 'bg-green-600 text-white' : 'btn-outline'}`}
          >
            + Add stock
          </button>
          <button
            type="button"
            onClick={() => setMode('stock_out')}
            className={`btn ${mode === 'stock_out' ? 'bg-red-600 text-white' : 'btn-outline'}`}
          >
            − Remove stock
          </button>
        </div>

        <div>
          <label className="label">Quantity</label>
          <input
            type="number"
            min={1}
            className="input"
            value={qty}
            autoFocus
            onChange={e => setQty(e.target.value)}
            placeholder="e.g. 10"
          />
        </div>

        <div>
          <label className="label">Notes (optional)</label>
          <input className="input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Reason, PO number, etc." />
        </div>

        {valid && (
          <p className="text-sm text-slate-600">
            New stock will be <span className={`font-semibold ${resulting < 0 ? 'text-red-600' : 'text-slate-900'}`}>{resulting}</span>
            {resulting < 0 && <span className="text-red-600"> (cannot go below 0)</span>}
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary disabled:opacity-40" onClick={save} disabled={!valid || saving || resulting < 0}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
