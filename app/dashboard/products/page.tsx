'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, inr } from '@/lib/fetch';

interface Product {
  id: number;
  sku: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  price: number;
  mrp: number | null;
  stock: number;
  reorderPoint: number;
  status: string;
  imageUrl: string | null;
  isBestseller: boolean;
  isNewArrival: boolean;
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
  const [page, setPage] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);

  const limit = 25;

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
      if (search) params.set('search', search);
      if (category) params.set('category', category);
      const data = await api<{ products: Product[]; total: number }>('/api/products?' + params);
      setProducts(data.products);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page, category]);

  useEffect(() => {
    api<{ categories: { name: string }[] }>('/api/categories').then(d => setCategories(d.categories.map(c => c.name)));
  }, []);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => { setPage(0); load(); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [search]);

  async function remove(id: number) {
    if (!confirm('Delete this product?')) return;
    await api(`/api/products/${id}`, { method: 'DELETE' });
    load();
  }

  // Toggle a merchandising flag (`isBestseller` / `isNewArrival`) in place.
  // Optimistic update with a rollback if the server rejects the PATCH.
  async function toggleFlag(p: Product, field: 'isBestseller' | 'isNewArrival') {
    const next = !p[field];
    setProducts((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, [field]: next } : x)),
    );
    try {
      await api(`/api/products/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: next }),
      });
    } catch (e) {
      // Revert on failure.
      setProducts((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, [field]: !next } : x)),
      );
      alert('Could not update. Please retry.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Products</h1>
          <p className="text-sm text-slate-500">{total.toLocaleString('en-IN')} total SKUs</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/variants/import" className="btn-outline">Bulk import variants</Link>
          <Link href="/dashboard/products/import" className="btn-outline">Bulk import</Link>
          <Link href="/dashboard/products/new" className="btn-primary">+ New product</Link>
        </div>
      </div>

      <div className="card p-4 flex flex-wrap gap-3">
        <input className="input max-w-xs" placeholder="Search name or SKU…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input max-w-xs" value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th></Th><Th>SKU</Th><Th>Name</Th><Th>Category</Th>
              <Th align="right">Price</Th><Th align="right">MRP</Th>
              <Th align="right">Stock</Th><Th>Status</Th><Th>Merchandising</Th><Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={10} className="p-8 text-center text-slate-400">Loading…</td></tr>}
            {!loading && products.length === 0 && <tr><td colSpan={10} className="p-8 text-center text-slate-400">No products match.</td></tr>}
            {products.map(p => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-2 py-2 w-12">
                  {imgSrc(p.imageUrl) ? (
                    <img src={imgSrc(p.imageUrl)!} alt="" className="w-10 h-10 object-contain bg-slate-50 rounded" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-slate-100 text-slate-400 text-xs flex items-center justify-center">—</div>
                  )}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{p.sku}</td>
                <td className="px-4 py-2">
                  <Link href={`/dashboard/products/${p.id}`} className="font-medium text-slate-900 hover:text-brand">{p.name}</Link>
                  {p.subcategory && <div className="text-xs text-slate-500">{p.subcategory}</div>}
                </td>
                <td className="px-4 py-2 text-slate-600">{p.category || '—'}</td>
                <td className="px-4 py-2 text-right font-medium">{inr(p.price)}</td>
                <td className="px-4 py-2 text-right text-slate-500">{inr(p.mrp)}</td>
                <td className="px-4 py-2 text-right">
                  <span className={p.stock <= p.reorderPoint ? 'pill-red' : 'pill-green'}>{p.stock}</span>
                </td>
                <td className="px-4 py-2">
                  <span className={p.status === 'active' ? 'pill-green' : p.status === 'draft' ? 'pill-yellow' : 'pill-gray'}>{p.status}</span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggleFlag(p, 'isBestseller')}
                      title={p.isBestseller ? 'Best Seller — click to remove' : 'Mark as Best Seller'}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide transition ${p.isBestseller ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                    >
                      Best
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleFlag(p, 'isNewArrival')}
                      title={p.isNewArrival ? 'New Arrival — click to remove' : 'Mark as New Arrival'}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide transition ${p.isNewArrival ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                    >
                      New
                    </button>
                  </div>
                </td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => remove(p.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} total={total} limit={limit} onPage={setPage} />
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`px-4 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide text-${align}`}>{children}</th>;
}

export function Pagination({ page, total, limit, onPage }: { page: number; total: number; limit: number; onPage: (p: number) => void }) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="text-slate-500">Page {page + 1} of {pages}</div>
      <div className="flex gap-2">
        <button className="btn-outline" disabled={page === 0} onClick={() => onPage(page - 1)}>← Prev</button>
        <button className="btn-outline" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next →</button>
      </div>
    </div>
  );
}
