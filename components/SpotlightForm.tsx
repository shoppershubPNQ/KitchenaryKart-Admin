'use client';

/**
 * Featured Spotlight editor — shared by /dashboard/spotlight/new and /[id].
 *
 * Everything here is admin-editable and feeds the dedicated /featured/<slug>
 * page (and the home teaser). Live price / stock / gallery images come from the
 * linked product at render time — those are NOT edited here. The regular
 * product page is never touched.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/fetch';

interface Spec { label: string; value: string }
interface WhyBuy { title: string; text: string }
interface CmpRow { feature: string; kk: string; others: string }

export interface SpotlightDraft {
  id?: number;
  slug: string;
  productSku: string;
  eyebrow?: string | null;
  headline?: string | null;
  videoUrl?: string | null;
  videoPoster?: string | null;
  keyFeatures?: string[];
  specifications?: Spec[];
  packagingIncludes?: string[];
  idealFor?: string[];
  whyBuy?: WhyBuy[];
  comparison?: { kkLabel?: string | null; othersLabel?: string | null; rows: CmpRow[] };
  careDisposal?: string | null;
  description?: string | null;
  position?: number;
  isActive?: boolean;
}

/* ---------- small reusable list editors ---------- */

function StringList({
  label, hint, items, onChange, placeholder,
}: { label: string; hint?: string; items: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      {hint && <p className="text-xs text-slate-500 mb-2">{hint}</p>}
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex gap-2">
            <input
              className="input flex-1"
              value={it}
              placeholder={placeholder}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button type="button" className="btn-outline !px-3" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </div>
      <button type="button" className="text-sm text-brand font-semibold mt-2" onClick={() => onChange([...items, ''])}>+ Add</button>
    </div>
  );
}

function SpecList({ items, onChange }: { items: Spec[]; onChange: (v: Spec[]) => void }) {
  return (
    <div>
      <label className="label">Specifications</label>
      <p className="text-xs text-slate-500 mb-2">Label + value rows (e.g. Capacity → 8 L). Shown as a spec table.</p>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex gap-2">
            <input className="input flex-1" placeholder="Label (e.g. Capacity)" value={it.label}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input className="input flex-[2]" placeholder="Value (e.g. 8 Litre)" value={it.value}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            <button type="button" className="btn-outline !px-3" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </div>
      <button type="button" className="text-sm text-brand font-semibold mt-2" onClick={() => onChange([...items, { label: '', value: '' }])}>+ Add spec</button>
    </div>
  );
}

function WhyBuyList({ items, onChange }: { items: WhyBuy[]; onChange: (v: WhyBuy[]) => void }) {
  return (
    <div>
      <label className="label">Why buy from KitchenaryKart</label>
      <p className="text-xs text-slate-500 mb-2">Short title + one-line reason each.</p>
      <div className="space-y-3">
        {items.map((it, i) => (
          <div key={i} className="flex gap-2 items-start">
            <div className="flex-1 space-y-2">
              <input className="input" placeholder="Title (e.g. GST invoice)" value={it.title}
                onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <input className="input" placeholder="Reason (e.g. Full input tax credit on every order)" value={it.text}
                onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
            </div>
            <button type="button" className="btn-outline !px-3" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </div>
      <button type="button" className="text-sm text-brand font-semibold mt-2" onClick={() => onChange([...items, { title: '', text: '' }])}>+ Add point</button>
    </div>
  );
}

type Cmp = { kkLabel?: string | null; othersLabel?: string | null; rows: CmpRow[] };

function ComparisonEditor({ value, onChange }: { value: Cmp; onChange: (v: Cmp) => void }) {
  const rows = value.rows || [];
  const set = (patch: Partial<Cmp>) => onChange({ kkLabel: value.kkLabel, othersLabel: value.othersLabel, rows, ...patch });
  return (
    <div>
      <label className="label">Comparison table</label>
      <p className="text-xs text-slate-500 mb-2">
        One row per feature. The two column headers name your product vs a typical other seller — leave blank to use
        “KitchenaryKart” / “Others”.
      </p>
      {/* Column-header labels, aligned above the value columns */}
      <div className="flex gap-2 mb-2">
        <div className="flex-1 self-center text-xs font-semibold text-slate-400">Feature ↓</div>
        <input className="input flex-1 font-semibold" placeholder="Your column (e.g. VAMA Cream Charger)"
          value={value.kkLabel ?? ''} onChange={(e) => set({ kkLabel: e.target.value })} />
        <input className="input flex-1 font-semibold" placeholder="Other column (e.g. Random Generic)"
          value={value.othersLabel ?? ''} onChange={(e) => set({ othersLabel: e.target.value })} />
        <div className="w-[42px] shrink-0" />
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <input className="input flex-1" placeholder="Feature (e.g. Gas Quality)" value={r.feature}
              onChange={(e) => set({ rows: rows.map((x, j) => (j === i ? { ...x, feature: e.target.value } : x)) })} />
            <input className="input flex-1" placeholder={value.kkLabel || 'Your product'} value={r.kk}
              onChange={(e) => set({ rows: rows.map((x, j) => (j === i ? { ...x, kk: e.target.value } : x)) })} />
            <input className="input flex-1" placeholder={value.othersLabel || 'Others'} value={r.others}
              onChange={(e) => set({ rows: rows.map((x, j) => (j === i ? { ...x, others: e.target.value } : x)) })} />
            <button type="button" className="btn-outline !px-3" onClick={() => set({ rows: rows.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
      </div>
      <button type="button" className="text-sm text-brand font-semibold mt-2" onClick={() => set({ rows: [...rows, { feature: '', kk: '', others: '' }] })}>+ Add row</button>
    </div>
  );
}

/* ---------- main form ---------- */

export function SpotlightForm({ initial, isNew }: { initial: SpotlightDraft; isNew: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<SpotlightDraft>({
    keyFeatures: [], specifications: [], packagingIncludes: [], idealFor: [], whyBuy: [],
    comparison: { rows: [] }, ...initial,
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function update<K extends keyof SpotlightDraft>(k: K, v: SpotlightDraft[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function handleUpload(file: File) {
    setUploading(true); setUploadPct(0); setErr(null);
    try {
      const signRes = await fetch('/api/spotlight/upload-sign', { method: 'POST', credentials: 'include' });
      const sign = await signRes.json();
      if (!signRes.ok) throw new Error(sign?.error || 'Could not get upload signature');
      const fd = new FormData();
      fd.append('file', file);
      fd.append('api_key', sign.apiKey);
      fd.append('timestamp', String(sign.timestamp));
      fd.append('signature', sign.signature);
      fd.append('folder', sign.folder);
      const res = await new Promise<{ ok: boolean; status: number; body: any }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', sign.uploadUrl);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100)); };
        xhr.onload = () => {
          try { resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body: JSON.parse(xhr.responseText || '{}') }); }
          catch { resolve({ ok: false, status: xhr.status, body: { error: xhr.responseText } }); }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(fd);
      });
      if (!res.ok) {
        const msg = res.body?.error?.message || res.body?.error || `Upload failed (${res.status})`;
        throw new Error(typeof msg === 'string' ? msg : 'Upload failed');
      }
      const secureUrl: string = res.body.secure_url;
      update('videoUrl', secureUrl);
      update('videoPoster', secureUrl.replace(/\.(mp4|mov|webm|m4v)(?:\?.*)?$/i, '.jpg'));
    } catch (e: any) {
      setErr(e?.message || 'Upload failed');
    } finally {
      setUploading(false); setUploadPct(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setSaving(true);
    try {
      if (!form.slug?.trim()) throw new Error('Slug is required (the /featured/<slug> URL).');
      if (!form.productSku?.trim()) throw new Error('Product SKU is required — the spotlight pulls live price/stock from it.');
      const clean = <T extends { [k: string]: any }>(arr: T[] | undefined, keys: (keyof T)[]) =>
        (arr || []).filter((row) => keys.some((k) => String(row[k] ?? '').trim() !== ''));
      const payload: SpotlightDraft = {
        ...form,
        slug: form.slug.trim().toLowerCase(),
        productSku: form.productSku.trim(),
        eyebrow: form.eyebrow?.trim() || null,
        headline: form.headline?.trim() || null,
        careDisposal: form.careDisposal?.trim() || null,
        description: form.description?.trim() || null,
        keyFeatures: (form.keyFeatures || []).map((s) => s.trim()).filter(Boolean),
        packagingIncludes: (form.packagingIncludes || []).map((s) => s.trim()).filter(Boolean),
        idealFor: (form.idealFor || []).map((s) => s.trim()).filter(Boolean),
        specifications: clean(form.specifications, ['label', 'value']),
        whyBuy: clean(form.whyBuy, ['title', 'text']),
        comparison: {
          kkLabel: form.comparison?.kkLabel?.trim() || null,
          othersLabel: form.comparison?.othersLabel?.trim() || null,
          rows: clean(form.comparison?.rows, ['feature', 'kk', 'others']),
        },
      };
      if (isNew) await api('/api/spotlight', { method: 'POST', body: JSON.stringify(payload) });
      else await api(`/api/spotlight/${initial.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      router.push('/dashboard/spotlight');
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6 max-w-4xl">
      {/* Basics */}
      <div className="card p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Basics</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Product SKU *</label>
            <input className="input" value={form.productSku} onChange={(e) => update('productSku', e.target.value)} placeholder="e.g. KKHE0048-CMM2C" />
            <p className="text-xs text-slate-500 mt-1">Live price, MRP, stock &amp; gallery images come from this product.</p>
          </div>
          <div>
            <label className="label">Page slug *</label>
            <input className="input" value={form.slug} onChange={(e) => update('slug', e.target.value)} placeholder="chocolate-melting-machine" />
            <p className="text-xs text-slate-500 mt-1">URL: /featured/<b>{form.slug || 'slug'}</b></p>
          </div>
          <div>
            <label className="label">Eyebrow (small line above title)</label>
            <input className="input" value={form.eyebrow || ''} onChange={(e) => update('eyebrow', e.target.value)} placeholder="Best Seller" />
          </div>
          <div>
            <label className="label">Headline override (blank = product name)</label>
            <input className="input" value={form.headline || ''} onChange={(e) => update('headline', e.target.value)} placeholder="Leave blank to use product name" />
          </div>
        </div>
      </div>

      {/* Video */}
      <div className="card p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Spotlight video (optional)</h3>
        <p className="text-xs text-slate-500 -mt-1">
          Where it shows: plays on <strong>hover</strong> in the home-page spotlight, and appears as the
          <strong> first item in the product gallery</strong> on the featured page (click to play). Skip it and the
          gallery just uses the product images.
        </p>
        <div className="w-full max-w-[420px] rounded-lg overflow-hidden bg-slate-900 border border-slate-200 grid place-items-center" style={{ aspectRatio: '16 / 9' }}>
          {form.videoUrl ? (
            <video key={form.videoUrl} src={form.videoUrl} poster={form.videoPoster || undefined} controls muted playsInline className="w-full h-full object-contain" />
          ) : (<span className="text-slate-300 text-sm">No video</span>)}
        </div>
        <div className="flex items-center gap-3">
          <label className="btn-outline cursor-pointer inline-flex items-center">
            {uploading ? (uploadPct !== null ? `Uploading… ${uploadPct}%` : 'Uploading…') : form.videoUrl ? 'Replace video' : 'Upload video'}
            <input type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v" onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} className="hidden" disabled={uploading} />
          </label>
          {form.videoUrl && <button type="button" className="text-sm text-red-600" onClick={() => { update('videoUrl', null); update('videoPoster', null); }}>Remove</button>}
        </div>
        <p className="text-xs text-slate-500">
          <strong>Format:</strong> MP4 / MOV / WebM (MP4 recommended). Uploaded straight to Cloudinary — large files are OK, it compresses on delivery.<br />
          <strong>Best ratio:</strong> square <strong>1:1</strong> or vertical <strong>9:16</strong> (like a Reel). Landscape 16:9 works too, but shows with side/letterbox bars in the square gallery viewer.<br />
          <strong>Length / size:</strong> keep it short — <strong>15–30 sec</strong>, up to 1080p (≈ under 50&nbsp;MB is ideal). The product’s own images fill the rest of the gallery automatically.
        </p>
      </div>

      {/* Content blocks */}
      <div className="card p-6 space-y-6">
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Content</h3>
        <StringList label="Key features" hint="Bullet points shown near the top." items={form.keyFeatures || []} onChange={(v) => update('keyFeatures', v)} placeholder="e.g. Food-grade stainless steel body" />
        <SpecList items={form.specifications || []} onChange={(v) => update('specifications', v)} />
        <StringList label="Packaging includes" items={form.packagingIncludes || []} onChange={(v) => update('packagingIncludes', v)} placeholder="e.g. 1 × Machine, 3 × GN Pans, 1 × Manual" />
        <StringList label="Ideal for" items={form.idealFor || []} onChange={(v) => update('idealFor', v)} placeholder="e.g. Cafés, Dessert counters, Cloud kitchens" />
        <div>
          <label className="label">Care &amp; disposal</label>
          <textarea className="input" rows={3} value={form.careDisposal || ''} onChange={(e) => update('careDisposal', e.target.value)} placeholder="How to clean, maintain and safely dispose of the product." />
        </div>
        <WhyBuyList items={form.whyBuy || []} onChange={(v) => update('whyBuy', v)} />
        <div>
          <label className="label">Description</label>
          <textarea className="input" rows={4} value={form.description || ''} onChange={(e) => update('description', e.target.value)} placeholder="Rich description for the featured page (kept separate from the product page)." />
        </div>
        <ComparisonEditor value={form.comparison || { rows: [] }} onChange={(v) => update('comparison', v)} />
      </div>

      {/* Publish */}
      <div className="card p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">Display order (lower = first)</label>
          <input type="number" className="input" value={form.position ?? 0} onChange={(e) => update('position', parseInt(e.target.value) || 0)} />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive ?? true} onChange={(e) => update('isActive', e.target.checked)} />
            <span>Active (show on the site)</span>
          </label>
        </div>
      </div>

      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}

      <div className="flex gap-3">
        <button type="submit" className="btn-primary" disabled={saving || uploading}>
          {saving ? 'Saving…' : isNew ? 'Create spotlight' : 'Save changes'}
        </button>
        <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
