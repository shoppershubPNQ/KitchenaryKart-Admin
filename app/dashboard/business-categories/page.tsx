'use client';

/**
 * Business categories — the BUSINESS-facing grouping a buyer shops by
 * ("Pizza Equipment", "Cafe Equipment"), as opposed to Products → Category,
 * which is the internal taxonomy.
 *
 * These cross-cut the taxonomy on purpose: one deep fryer can sit in Pizza,
 * Burger and Cafe at once, so membership is a curated list rather than a
 * column on the product.
 *
 * Every category is built BY HAND — search the catalogue, click to add, and
 * arrange with the arrows. The saved order is the order the storefront renders,
 * so put the anchor products first.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/fetch';

interface BusinessCategory {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  productSkus: string[];
  sortOrder: number;
  isActive: boolean;
  productCount: number;
}
interface ApiProduct {
  sku: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  imageUrl: string | null;
}
interface ApiResponse {
  categories: BusinessCategory[];
  products: ApiProduct[];
}

const BLANK = {
  name: '', slug: '', description: '', imageUrl: '', metaTitle: '', metaDescription: '',
  productSkus: [] as string[], sortOrder: 0, isActive: true,
};

/** "Pizza Equipment" → "pizza-equipment" */
function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export default function BusinessCategoriesPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await api<ApiResponse>('/api/business-categories'));
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const bySku = useMemo(() => {
    const m = new Map<string, ApiProduct>();
    data?.products.forEach((p) => m.set(p.sku, p));
    return m;
  }, [data]);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    const chosen = new Set(form.productSkus);
    return (data?.products || [])
      .filter((p) => !chosen.has(p.sku))
      .filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .slice(0, 25);
  }, [search, data, form.productSkus]);

  function startNew() {
    setEditingId('new');
    setForm({ ...BLANK });
    setSearch('');
    setMsg(null);
  }
  function startEdit(c: BusinessCategory) {
    setEditingId(c.id);
    setForm({
      name: c.name, slug: c.slug, description: c.description || '', imageUrl: c.imageUrl || '',
      metaTitle: c.metaTitle || '', metaDescription: c.metaDescription || '',
      productSkus: [...c.productSkus], sortOrder: c.sortOrder, isActive: c.isActive,
    });
    setSearch('');
    setMsg(null);
  }

  function addSku(sku: string) {
    setForm((f) => (f.productSkus.includes(sku) ? f : { ...f, productSkus: [...f.productSkus, sku] }));
    setSearch('');
  }
  function removeSku(sku: string) {
    setForm((f) => ({ ...f, productSkus: f.productSkus.filter((x) => x !== sku) }));
  }
  /** Move a picked product one slot up or down — the stored order IS the
   *  storefront order, so this is how the anchor products get to the top. */
  function move(i: number, dir: -1 | 1) {
    setForm((f) => {
      const next = [...f.productSkus];
      const j = i + dir;
      if (j < 0 || j >= next.length) return f;
      [next[i], next[j]] = [next[j], next[i]];
      return { ...f, productSkus: next };
    });
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const payload = {
        ...form,
        slug: form.slug || slugify(form.name),
        description: form.description || null,
        imageUrl: form.imageUrl || null,
        metaTitle: form.metaTitle || null,
        metaDescription: form.metaDescription || null,
        sortOrder: Number(form.sortOrder) || 0,
      };
      if (editingId === 'new') {
        await api('/api/business-categories', { method: 'POST', body: JSON.stringify(payload) });
        setMsg('Category created');
      } else {
        await api(`/api/business-categories/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        setMsg('Saved');
      }
      setEditingId(null);
      await load();
    } catch (e: any) {
      setMsg(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: BusinessCategory) {
    if (!confirm(`Delete "${c.name}"?\n\nThis removes the grouping only — no product is changed or deleted.`)) return;
    setSaving(true);
    try {
      await api(`/api/business-categories/${c.id}`, { method: 'DELETE' });
      setMsg(`Deleted "${c.name}"`);
      if (editingId === c.id) setEditingId(null);
      await load();
    } catch (e: any) {
      setMsg(e?.message || 'Delete failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-xl font-semibold text-slate-800">Business categories</h1>
        <button onClick={startNew} className="px-3 py-1.5 rounded bg-slate-800 text-white text-sm hover:bg-slate-700">
          + New category
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-5 max-w-3xl">
        The grouping a customer shops by — “Pizza Equipment”, “Cafe Equipment”. Separate from
        Products → Category, and deliberately overlapping: one fryer can sit in Pizza, Burger and
        Cafe at the same time. Each category is built by hand, and the order you arrange is the
        order the website shows.
      </p>

      {msg && <div className="mb-4 text-sm px-3 py-2 rounded bg-slate-100 text-slate-700">{msg}</div>}

      <div className="border border-slate-200 rounded overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Name</th>
              <th className="text-left px-3 py-2 font-medium">Page</th>
              <th className="text-right px-3 py-2 font-medium">Products</th>
              <th className="text-right px-3 py-2 font-medium">Order</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {data?.categories.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-800">{c.name}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500">/business/{c.slug}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.productCount}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{c.sortOrder}</td>
                <td className="px-3 py-2">
                  <span className={`text-[11px] px-2 py-0.5 rounded ${c.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {c.isActive ? 'Active' : 'Hidden'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => startEdit(c)} className="text-slate-600 hover:text-slate-900 text-xs mr-3">Edit</button>
                  <button onClick={() => remove(c)} className="text-red-600 hover:text-red-700 text-xs">Delete</button>
                </td>
              </tr>
            ))}
            {!data?.categories.length && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400 text-sm">
                  No business categories yet — click “New category” to create your first one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingId !== null && (
        <div className="border border-slate-300 rounded p-5 bg-white">
          <h2 className="font-semibold text-slate-800 mb-4">
            {editingId === 'new' ? 'New business category' : `Edit — ${form.name}`}
          </h2>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Name</span>
              <input
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                placeholder="e.g. Pizza Equipment"
                value={form.name}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  name: e.target.value,
                  // Auto-fill the slug only while creating; changing it later
                  // would break a live URL.
                  slug: editingId === 'new' ? slugify(e.target.value) : f.slug,
                }))}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Slug (URL)</span>
              <input
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm font-mono"
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              />
              <span className="text-[11px] text-slate-400">kitchenarykart.com/business/{form.slug || '…'}</span>
            </label>
          </div>

          <label className="block mb-4">
            <span className="text-xs font-medium text-slate-600">Description</span>
            <textarea
              rows={2}
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
              placeholder="Shown under the heading on the page."
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </label>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Meta title (SEO)</span>
              <input className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                placeholder="Leave blank to use the name"
                value={form.metaTitle} onChange={(e) => setForm((f) => ({ ...f, metaTitle: e.target.value }))} />
              <span className="text-[11px] text-slate-400">“— KitchenaryKart” is added automatically.</span>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Meta description (SEO)</span>
              <input className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                value={form.metaDescription} onChange={(e) => setForm((f) => ({ ...f, metaDescription: e.target.value }))} />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-5">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Image URL</span>
              <input className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                value={form.imageUrl} onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Sort order</span>
              <input type="number" className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))} />
              <span className="text-[11px] text-slate-400">Lower shows first.</span>
            </label>
            <label className="flex items-end gap-2 pb-1.5">
              <input type="checkbox" checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
              <span className="text-sm text-slate-700">Active (visible on site)</span>
            </label>
          </div>

          {/* ---- product picker ---- */}
          <div className="mb-5">
            <div className="text-xs font-medium text-slate-600 mb-1">
              Products
              <span className="ml-2 text-slate-400 font-normal">{form.productSkus.length} selected</span>
            </div>
            <input
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
              placeholder="Search the catalogue by name or SKU (min 2 characters)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {results.length > 0 && (
              <div className="border border-slate-200 rounded mt-1 max-h-64 overflow-y-auto">
                {results.map((p) => (
                  <button
                    key={p.sku}
                    type="button"
                    onClick={() => addSku(p.sku)}
                    className="w-full text-left px-2 py-1.5 text-xs hover:bg-slate-50 border-b border-slate-100 last:border-0"
                  >
                    <span className="font-mono text-[10px] text-slate-400 mr-2">{p.sku}</span>
                    {p.name}
                    {p.subcategory && <span className="text-slate-400 ml-2">· {p.subcategory}</span>}
                  </button>
                ))}
              </div>
            )}

            {form.productSkus.length === 0 ? (
              <p className="text-[11px] text-slate-400 mt-2">
                No products yet. Search above and click a result to add it.
              </p>
            ) : (
              <ol className="mt-3 border border-slate-200 rounded divide-y divide-slate-100">
                {form.productSkus.map((sku, i) => {
                  const p = bySku.get(sku);
                  return (
                    <li key={sku} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                      <span className="w-6 text-slate-400 tabular-nums">{i + 1}</span>
                      <span className="flex-1 truncate">
                        <span className="font-mono text-[10px] text-slate-400 mr-2">{sku}</span>
                        {p ? p.name : <span className="text-red-600">not found in catalogue</span>}
                      </span>
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                        className="px-1 text-slate-400 hover:text-slate-800 disabled:opacity-30" title="Move up">↑</button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === form.productSkus.length - 1}
                        className="px-1 text-slate-400 hover:text-slate-800 disabled:opacity-30" title="Move down">↓</button>
                      <button type="button" onClick={() => removeSku(sku)}
                        className="px-1 text-red-500 hover:text-red-700" title="Remove">×</button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving || !form.name.trim()}
              className="px-4 py-1.5 rounded bg-slate-800 text-white text-sm hover:bg-slate-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setEditingId(null)} className="text-sm text-slate-500 hover:text-slate-800">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
