'use client';

/**
 * Business categories — the BUSINESS-facing grouping a buyer shops by
 * ("Pizza Equipment", "Cafe Equipment"), as opposed to Products → Category,
 * which is the internal taxonomy.
 *
 * These cross-cut the taxonomy on purpose: one deep fryer belongs to Pizza,
 * Burger and Cafe at once, so membership is a RULE, not a column on the
 * product. Each category resolves to:
 *
 *     (active products in the ticked subcategories)
 *   + (individually added SKUs)
 *   - (individually removed SKUs)
 *
 * Tick a subcategory to pull in 40 products at once; use the search box below
 * to add a one-off, or Remove to drop something the rule wrongly caught. The
 * count next to each category is live — it is what the storefront will show.
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
  subcategories: string[];
  productSkus: string[];
  excludeSkus: string[];
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
  subcategoryOptions: string[];
  products: ApiProduct[];
}

const BLANK = {
  name: '', slug: '', description: '', imageUrl: '', metaTitle: '', metaDescription: '',
  subcategories: [] as string[], productSkus: [] as string[], excludeSkus: [] as string[],
  sortOrder: 0, isActive: true,
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

  /** How many products each subcategory would contribute — shown on the chip
   *  so the curator can see the weight of a rule before ticking it. */
  const subCounts = useMemo(() => {
    const m = new Map<string, number>();
    data?.products.forEach((p) => {
      if (!p.subcategory) return;
      m.set(p.subcategory, (m.get(p.subcategory) || 0) + 1);
    });
    return m;
  }, [data]);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return (data?.products || [])
      .filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .slice(0, 25);
  }, [search, data]);

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
      subcategories: [...c.subcategories], productSkus: [...c.productSkus], excludeSkus: [...c.excludeSkus],
      sortOrder: c.sortOrder, isActive: c.isActive,
    });
    setSearch('');
    setMsg(null);
  }

  function toggleSub(s: string) {
    setForm((f) => ({
      ...f,
      subcategories: f.subcategories.includes(s)
        ? f.subcategories.filter((x) => x !== s)
        : [...f.subcategories, s],
    }));
  }

  function addSku(sku: string) {
    setForm((f) => ({
      ...f,
      // Adding a sku also clears any prior exclusion of it, otherwise the
      // exclude list would silently cancel the add.
      productSkus: f.productSkus.includes(sku) ? f.productSkus : [...f.productSkus, sku],
      excludeSkus: f.excludeSkus.filter((x) => x !== sku),
    }));
    setSearch('');
  }
  function excludeSku(sku: string) {
    setForm((f) => ({
      ...f,
      productSkus: f.productSkus.filter((x) => x !== sku),
      excludeSkus: f.excludeSkus.includes(sku) ? f.excludeSkus : [...f.excludeSkus, sku],
    }));
  }
  function unexclude(sku: string) {
    setForm((f) => ({ ...f, excludeSkus: f.excludeSkus.filter((x) => x !== sku) }));
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
        Cafe at the same time. Membership = ticked subcategories + added SKUs − removed SKUs.
      </p>

      {msg && <div className="mb-4 text-sm px-3 py-2 rounded bg-slate-100 text-slate-700">{msg}</div>}

      <div className="border border-slate-200 rounded overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Name</th>
              <th className="text-left px-3 py-2 font-medium">Slug</th>
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
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400 text-sm">No business categories yet.</td></tr>
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
                value={form.name}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  name: e.target.value,
                  // Only auto-fill the slug while creating; changing it later
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
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </label>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Meta title (SEO)</span>
              <input className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                value={form.metaTitle} onChange={(e) => setForm((f) => ({ ...f, metaTitle: e.target.value }))} />
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
            </label>
            <label className="flex items-end gap-2 pb-1.5">
              <input type="checkbox" checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
              <span className="text-sm text-slate-700">Active (visible on site)</span>
            </label>
          </div>

          {/* ---- subcategory rule ---- */}
          <div className="mb-5">
            <div className="text-xs font-medium text-slate-600 mb-1">
              Subcategories — tick to include every active product in them
              <span className="ml-2 text-slate-400 font-normal">{form.subcategories.length} selected</span>
            </div>
            <div className="border border-slate-200 rounded p-2 max-h-48 overflow-y-auto flex flex-wrap gap-1.5">
              {data?.subcategoryOptions.map((s) => {
                const on = form.subcategories.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSub(s)}
                    className={`text-[11px] px-2 py-1 rounded border ${on
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
                  >
                    {s} <span className={on ? 'text-slate-300' : 'text-slate-400'}>({subCounts.get(s) || 0})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ---- manual additions ---- */}
          <div className="mb-5">
            <div className="text-xs font-medium text-slate-600 mb-1">
              Add individual products
              <span className="ml-2 text-slate-400 font-normal">{form.productSkus.length} added</span>
            </div>
            <input
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
              placeholder="Search by name or SKU (min 2 characters)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {results.length > 0 && (
              <div className="border border-slate-200 rounded mt-1 max-h-52 overflow-y-auto">
                {results.map((p) => (
                  <button
                    key={p.sku}
                    type="button"
                    onClick={() => addSku(p.sku)}
                    className="w-full text-left px-2 py-1.5 text-xs hover:bg-slate-50 border-b border-slate-100 last:border-0"
                  >
                    <span className="font-mono text-[10px] text-slate-400 mr-2">{p.sku}</span>
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            {form.productSkus.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {form.productSkus.map((sku) => (
                  <span key={sku} className="text-[11px] bg-emerald-50 text-emerald-800 border border-emerald-200 rounded px-2 py-1">
                    {bySku.get(sku)?.name?.slice(0, 40) || sku}
                    <button type="button" onClick={() => setForm((f) => ({ ...f, productSkus: f.productSkus.filter((x) => x !== sku) }))}
                      className="ml-1.5 text-emerald-600 hover:text-emerald-900">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ---- exclusions ---- */}
          <div className="mb-5">
            <div className="text-xs font-medium text-slate-600 mb-1">
              Removed products — these never appear, even if a ticked subcategory includes them
              <span className="ml-2 text-slate-400 font-normal">{form.excludeSkus.length} removed</span>
            </div>
            {form.excludeSkus.length === 0 ? (
              <p className="text-[11px] text-slate-400">
                Nothing removed. Use this when a subcategory rule pulls in something that does not belong.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {form.excludeSkus.map((sku) => (
                  <span key={sku} className="text-[11px] bg-red-50 text-red-800 border border-red-200 rounded px-2 py-1">
                    {bySku.get(sku)?.name?.slice(0, 40) || sku}
                    <button type="button" onClick={() => unexclude(sku)} className="ml-1.5 text-red-500 hover:text-red-800">undo</button>
                  </span>
                ))}
              </div>
            )}
            <input
              className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm mt-2"
              placeholder="Type a SKU to remove it from this category…"
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                const v = (e.target as HTMLInputElement).value.trim();
                if (v) { excludeSku(v); (e.target as HTMLInputElement).value = ''; }
              }}
            />
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
