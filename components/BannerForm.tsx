'use client';

/**
 * Banner editor — shared by `/dashboard/banners/new` and
 * `/dashboard/banners/[id]`. Handles:
 *   - image upload via POST /api/banners/upload
 *   - preview in the storefront's 1908:553 hero aspect ratio
 *   - CTA target chooser (URL | product SKU | category)
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/fetch';

export interface BannerDraft {
  id?: number;
  /** Storefront slot — "hero" (Banner 1) or "secondary" (Banner 2). */
  placement?: 'hero' | 'secondary';
  position?: number;
  isActive?: boolean;
  imageUrl: string;
  alt?: string | null;
  eyebrow?: string | null;
  title?: string | null;
  subtitle?: string | null;
  ctaText?: string | null;
  ctaHref?: string | null;
  productSku?: string | null;
  category?: string | null;
}

type LinkKind = 'none' | 'url' | 'product' | 'category' | 'subcategory';

const WEB_BASE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001';
function preview(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:/i.test(url)) return url;
  return WEB_BASE.replace(/\/$/, '') + url;
}

/**
 * Pick the right initial UI mode for the link-target chooser. The schema
 * stores the picked value in `category` regardless of whether the admin
 * chose a category (Banner 1) or a subcategory (Banner 2) — placement
 * disambiguates at render time on the storefront.
 */
function inferLinkKind(d: BannerDraft): LinkKind {
  if (d.productSku) return 'product';
  if (d.category) return d.placement === 'secondary' ? 'subcategory' : 'category';
  if (d.ctaHref) return 'url';
  return 'none';
}

export function BannerForm({ initial, isNew }: { initial: BannerDraft; isNew: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<BannerDraft>(initial);
  const [linkKind, setLinkKind] = useState<LinkKind>(inferLinkKind(initial));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [subcategories, setSubcategories] = useState<
    { category: string; subcategory: string; count: number }[]
  >([]);

  useEffect(() => {
    api<{ categories: { name: string }[] }>('/api/categories')
      .then((d) => setCategories(d.categories.map((c) => c.name)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (form.placement !== 'secondary') return;
    api<{ subcategories: { category: string; subcategory: string; count: number }[] }>(
      '/api/subcategories',
    )
      .then((d) => setSubcategories(d.subcategories))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.placement]);

  function update<K extends keyof BannerDraft>(k: K, v: BannerDraft[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/banners/upload', { method: 'POST', body: fd, credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Upload failed');
      update('imageUrl', data.imageUrl);
    } catch (e: any) {
      setErr(e?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      if (!form.imageUrl) throw new Error('Please upload a banner image.');

      // Clean the CTA target fields so only one source of truth gets sent.
      // Both `category` and `subcategory` link kinds write to `form.category`
      // — placement disambiguates at storefront render time.
      const usesCategoryField = linkKind === 'category' || linkKind === 'subcategory';
      const payload: BannerDraft = {
        ...form,
        productSku: linkKind === 'product' ? form.productSku || null : null,
        category: usesCategoryField ? form.category || null : null,
        ctaHref: linkKind === 'url' ? form.ctaHref || null : null,
      };

      if (isNew) {
        await api('/api/banners', { method: 'POST', body: JSON.stringify(payload) });
      } else {
        await api(`/api/banners/${initial.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      }
      // Land back on the list scoped to this banner's placement so the admin
      // sees the row they just created/edited.
      const listHref = form.placement === 'secondary'
        ? '/dashboard/banners-2'
        : '/dashboard/banners';
      router.push(listHref);
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  const previewUrl = preview(form.imageUrl);
  const isSecondary = form.placement === 'secondary';

  // Secondary banners (Banner 2) feed the PromoCarousel section, where the
  // image is rendered as a roughly square product cut-out. Hero banners
  // (Banner 1) are full-width 1908:553 hero strips. Preview accordingly.
  const previewAspect = isSecondary ? '1 / 1' : '1908 / 553';
  const previewObjectFit = isSecondary ? 'object-contain' : 'object-cover';
  const previewSizeHint = isSecondary
    ? 'Square / transparent PNG works best — the storefront shows it as a floating product cut-out.'
    : 'Recommended aspect ratio 1908×553 (~3.45:1) — anything else is center-cropped to fit.';

  return (
    <form onSubmit={submit} className="space-y-6 max-w-4xl">
      <div className="card p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Image</h3>

        <div
          className="w-full rounded-lg overflow-hidden bg-slate-100 border border-slate-200 grid place-items-center"
          style={{ aspectRatio: previewAspect, maxHeight: isSecondary ? 360 : undefined }}
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt=""
              className={`w-full h-full ${previewObjectFit}`}
            />
          ) : (
            <span className="text-slate-400 text-sm">No image selected</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="btn-outline cursor-pointer inline-flex items-center">
            {uploading ? 'Uploading…' : 'Upload image'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
              className="hidden"
              disabled={uploading}
            />
          </label>
          {form.imageUrl && (
            <code className="text-xs text-slate-500 truncate max-w-[420px]">{form.imageUrl}</code>
          )}
        </div>
        <p className="text-xs text-slate-500">
          {previewSizeHint} JPG / PNG / WebP / GIF, max 8 MB.
        </p>
      </div>

      {/* Slide copy — only Banner 2 surfaces text fields. The fields are
          split into "Left side" (kicker + headline) and "Right side"
          (body + CTA button text) groups so the editor mirrors how the
          slide is laid out on the storefront. */}
      {isSecondary && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-1">
                Left side
              </h3>
              <p className="text-xs text-slate-500">
                The kicker line + huge headline that sit on the left of the slide.
              </p>
            </div>
            <div>
              <label className="label">Kicker (small line above headline)</label>
              <input
                className="input"
                value={form.eyebrow || ''}
                onChange={(e) => update('eyebrow', e.target.value)}
                placeholder="e.g. Bake like a pro."
              />
            </div>
            <div>
              <label className="label">Headline</label>
              <input
                className="input"
                value={form.title || ''}
                onChange={(e) => update('title', e.target.value)}
                placeholder="e.g. Pizza Ovens"
              />
            </div>
          </div>

          <div className="card p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-1">
                Right side
              </h3>
              <p className="text-xs text-slate-500">
                The descriptive body + Shop Now button on the right of the slide.
              </p>
            </div>
            <div>
              <label className="label">Body</label>
              <textarea
                className="input"
                rows={3}
                value={form.subtitle || ''}
                onChange={(e) => update('subtitle', e.target.value)}
                placeholder="e.g. Stone-deck ovens with even top-and-bottom fire — production-grade throughput."
              />
            </div>
            <div>
              <label className="label">Button text</label>
              <input
                className="input"
                value={form.ctaText || ''}
                onChange={(e) => update('ctaText', e.target.value)}
                placeholder="e.g. Shop Now"
              />
            </div>
            <div>
              <label className="label">Alt text (accessibility)</label>
              <input
                className="input"
                value={form.alt || ''}
                onChange={(e) => update('alt', e.target.value)}
                placeholder="e.g. Twin-deck commercial pizza oven"
              />
            </div>
          </div>
        </div>
      )}

      <div className="card p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-1">
            {isSecondary ? 'Where does the Shop Now button go?' : 'Where does the banner link to?'}
          </h3>
          <p className="text-xs text-slate-500">
            {isSecondary
              ? 'Pick what opens when a visitor clicks the slide’s call-to-action button.'
              : 'The whole banner is clickable on the storefront. Pick what opens when a visitor taps it.'}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="label">Link target</label>
            <select
              className="input"
              value={linkKind}
              onChange={(e) => setLinkKind(e.target.value as LinkKind)}
            >
              <option value="none">No link (decorative banner)</option>
              <option value="url">Custom URL</option>
              <option value="product">Specific product (SKU)</option>
              {/* Banner 2 targets a subcategory; Banner 1 targets a category. */}
              {isSecondary ? (
                <option value="subcategory">Subcategory</option>
              ) : (
                <option value="category">Category</option>
              )}
            </select>
          </div>
          {linkKind === 'url' && (
            <div className="md:col-span-2">
              <label className="label">URL</label>
              <input className="input" value={form.ctaHref || ''} onChange={(e) => update('ctaHref', e.target.value)} placeholder="/shop?q=ice   or   https://example.com" />
            </div>
          )}
          {linkKind === 'product' && (
            <div className="md:col-span-2">
              <label className="label">Product SKU</label>
              <input className="input" value={form.productSku || ''} onChange={(e) => update('productSku', e.target.value)} placeholder="e.g. HEPHE0224-G3D9TWOS" />
              <p className="text-xs text-slate-500 mt-1">Clicking the banner opens /product/&lt;SKU&gt;.</p>
            </div>
          )}
          {linkKind === 'category' && (
            <div className="md:col-span-2">
              <label className="label">Category</label>
              {categories.length > 0 ? (
                <select className="input" value={form.category || ''} onChange={(e) => update('category', e.target.value)}>
                  <option value="">— select a category —</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <input className="input" value={form.category || ''} onChange={(e) => update('category', e.target.value)} placeholder="e.g. HOT EQUIPMENT" />
              )}
              <p className="text-xs text-slate-500 mt-1">Clicking the banner opens /shop?cat=&lt;name&gt;.</p>
            </div>
          )}
          {linkKind === 'subcategory' && (
            <div className="md:col-span-2">
              <label className="label">Subcategory</label>
              {subcategories.length > 0 ? (
                <select
                  className="input"
                  value={form.category || ''}
                  onChange={(e) => update('category', e.target.value)}
                >
                  <option value="">— select a subcategory —</option>
                  {subcategories.map((s) => (
                    <option
                      key={`${s.category}::${s.subcategory}`}
                      value={s.subcategory}
                    >
                      {s.category} › {s.subcategory} ({s.count})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  value={form.category || ''}
                  onChange={(e) => update('category', e.target.value)}
                  placeholder="e.g. PIZZA OVEN"
                />
              )}
              <p className="text-xs text-slate-500 mt-1">
                Clicking the Shop Now button opens /shop?sub=&lt;name&gt;.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="card p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">Display order (lower = first)</label>
          <input type="number" className="input" value={form.position ?? 0} onChange={(e) => update('position', parseInt(e.target.value) || 0)} />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive ?? true}
              onChange={(e) => update('isActive', e.target.checked)}
            />
            <span>Show this banner on the home page</span>
          </label>
        </div>
      </div>

      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}

      <div className="flex gap-3">
        <button type="submit" className="btn-primary" disabled={saving || uploading || !form.imageUrl}>
          {saving ? 'Saving…' : isNew ? 'Create banner' : 'Save changes'}
        </button>
        <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
