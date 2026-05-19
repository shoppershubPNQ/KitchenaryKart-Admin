'use client';

/**
 * Reel editor — shared by `/dashboard/reels/new` and `/dashboard/reels/[id]`.
 *
 * Flow:
 *   1. Upload an MP4 via POST /api/reels/upload (Cloudinary)
 *   2. Preview plays inline as a <video>
 *   3. Optional: paste an Instagram URL, link a product SKU, set view count
 *   4. Save via POST /api/reels (new) or PATCH /api/reels/[id] (edit)
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/fetch';

export interface ReelDraft {
  id?: number;
  videoUrl: string;
  thumbnailUrl?: string | null;
  caption?: string | null;
  instagramUrl?: string | null;
  productSku?: string | null;
  viewCount?: number;
  position?: number;
  isActive?: boolean;
}

export function ReelForm({ initial, isNew }: { initial: ReelDraft; isNew: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<ReelDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function update<K extends keyof ReelDraft>(k: K, v: ReelDraft[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadPct(0);
    setErr(null);
    try {
      // Step 1: ask our admin for a signed Cloudinary upload payload.
      // The signature stays small (well under Vercel's 4.5 MB body limit).
      const signRes = await fetch('/api/reels/upload-sign', {
        method: 'POST',
        credentials: 'include',
      });
      const sign = await signRes.json();
      if (!signRes.ok) throw new Error(sign?.error || 'Could not get upload signature');

      // Step 2: upload the file directly to Cloudinary using XHR (for
      // progress events). This bypasses Vercel entirely — Cloudinary
      // accepts files up to 100 MB on the free tier.
      const fd = new FormData();
      fd.append('file', file);
      fd.append('api_key', sign.apiKey);
      fd.append('timestamp', String(sign.timestamp));
      fd.append('signature', sign.signature);
      fd.append('folder', sign.folder);

      const res = await new Promise<{ ok: boolean; status: number; body: any }>(
        (resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', sign.uploadUrl);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => {
            try {
              resolve({
                ok: xhr.status >= 200 && xhr.status < 300,
                status: xhr.status,
                body: JSON.parse(xhr.responseText || '{}'),
              });
            } catch {
              resolve({ ok: false, status: xhr.status, body: { error: xhr.responseText } });
            }
          };
          xhr.onerror = () => reject(new Error('Network error'));
          xhr.send(fd);
        },
      );

      if (!res.ok) {
        const msg = res.body?.error?.message || res.body?.error || `Upload failed (${res.status})`;
        throw new Error(typeof msg === 'string' ? msg : 'Upload failed');
      }

      // Cloudinary returns secure_url for the video; we derive the poster
      // JPG by swapping the extension (Cloudinary serves it on demand).
      const secureUrl: string = res.body.secure_url;
      update('videoUrl', secureUrl);
      update(
        'thumbnailUrl',
        secureUrl.replace(/\.(mp4|mov|webm|m4v)(?:\?.*)?$/i, '.jpg'),
      );
    } catch (e: any) {
      setErr(e?.message || 'Upload failed');
    } finally {
      setUploading(false);
      setUploadPct(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      if (!form.videoUrl) throw new Error('Please upload a video first.');
      const payload: ReelDraft = {
        ...form,
        productSku: form.productSku?.trim() || null,
        caption: form.caption?.trim() || null,
        instagramUrl: form.instagramUrl?.trim() || null,
        thumbnailUrl: form.thumbnailUrl?.trim() || null,
      };

      if (isNew) {
        await api('/api/reels', { method: 'POST', body: JSON.stringify(payload) });
      } else {
        await api(`/api/reels/${initial.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      }
      router.push('/dashboard/reels');
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6 max-w-4xl">
      <div className="card p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Video</h3>

        <div
          className="w-full max-w-[260px] mx-auto rounded-lg overflow-hidden bg-slate-900 border border-slate-200 grid place-items-center"
          style={{ aspectRatio: '9 / 16' }}
        >
          {form.videoUrl ? (
            <video
              key={form.videoUrl}
              src={form.videoUrl}
              poster={form.thumbnailUrl || undefined}
              controls
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-slate-300 text-sm">No video uploaded</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 justify-center">
          <label className="btn-outline cursor-pointer inline-flex items-center">
            {uploading
              ? uploadPct !== null
                ? `Uploading… ${uploadPct}%`
                : 'Uploading…'
              : form.videoUrl
              ? 'Replace video'
              : 'Upload video'}
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-m4v"
              onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
              className="hidden"
              disabled={uploading}
            />
          </label>
        </div>
        {form.videoUrl && (
          <code className="block text-xs text-slate-500 truncate text-center">{form.videoUrl}</code>
        )}
        <p className="text-xs text-slate-500 text-center">
          MP4, MOV or WebM. Max 60 MB. Portrait (9:16) recommended — matches the storefront card aspect.
        </p>
      </div>

      <div className="card p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Caption &amp; link</h3>
        <div>
          <label className="label">Caption (shown under the reel card on hover)</label>
          <textarea
            className="input"
            rows={2}
            value={form.caption || ''}
            onChange={(e) => update('caption', e.target.value)}
            placeholder="e.g. Watch how easy it is to use the VAMA Cream Charger."
          />
        </div>
        <div>
          <label className="label">Linked product SKU (clicking the card opens this product)</label>
          <input
            className="input"
            value={form.productSku || ''}
            onChange={(e) => update('productSku', e.target.value)}
            placeholder="e.g. KKA0057-CWH500"
          />
          <p className="text-xs text-slate-500 mt-1">
            Leave blank if the reel doesn't link to a single product. The product's
            current name + price are pulled live so they stay in sync.
          </p>
        </div>
        <div>
          <label className="label">Original Instagram URL (admin reference only)</label>
          <input
            className="input"
            value={form.instagramUrl || ''}
            onChange={(e) => update('instagramUrl', e.target.value)}
            placeholder="https://www.instagram.com/kitchenarykart/reel/..."
          />
        </div>
      </div>

      <div className="card p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="label">View count (0 = auto)</label>
          <input
            type="number"
            min={0}
            className="input"
            value={form.viewCount ?? 0}
            onChange={(e) => update('viewCount', parseInt(e.target.value) || 0)}
          />
          <p className="text-xs text-slate-500 mt-1">
            Override the auto-generated count if you want to surface real Instagram views.
          </p>
        </div>
        <div>
          <label className="label">Display order (lower = first)</label>
          <input
            type="number"
            className="input"
            value={form.position ?? 0}
            onChange={(e) => update('position', parseInt(e.target.value) || 0)}
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive ?? true}
              onChange={(e) => update('isActive', e.target.checked)}
            />
            <span>Show on home page</span>
          </label>
        </div>
      </div>

      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}

      <div className="flex gap-3">
        <button type="submit" className="btn-primary" disabled={saving || uploading || !form.videoUrl}>
          {saving ? 'Saving…' : isNew ? 'Create reel' : 'Save changes'}
        </button>
        <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
