'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/fetch';

/**
 * "Duplicate" for one product: a small dialog for the copy's SKU, name and
 * status, then POST /api/products/:id/duplicate and straight to the copy's
 * page. Used by the products list (icon) and the product page (button).
 */
export function DuplicateProductButton({
  productId,
  sku,
  name,
  variantCount = 0,
  variant = 'icon',
}: {
  productId: number;
  sku: string;
  name: string;
  variantCount?: number;
  variant?: 'icon' | 'button';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newSku, setNewSku] = useState(`${sku}-COPY`);
  const [newName, setNewName] = useState(`${name} (copy)`);
  const [status, setStatus] = useState<'draft' | 'active'>('draft');
  const [withVariants, setWithVariants] = useState(true);
  const [withImages, setWithImages] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ product: { id: number; sku: string }; message: string }>(
        `/api/products/${productId}/duplicate`,
        {
          method: 'POST',
          body: JSON.stringify({ sku: newSku.trim(), name: newName.trim(), status, withVariants, withImages }),
        },
      );
      setOpen(false);
      router.push(`/dashboard/products/${r.product.id}`);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || 'Could not duplicate');
    } finally {
      setBusy(false);
    }
  }

  const trigger =
    variant === 'button' ? (
      <button type="button" className="btn-outline gap-1.5" onClick={() => setOpen(true)}>
        <CopyIcon /> Duplicate
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Duplicate this listing"
        className="w-8 h-8 grid place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-brand"
      >
        <CopyIcon />
      </button>
    );

  return (
    <>
      {trigger}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => !busy && setOpen(false)}>
          <form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="mt-16 w-full max-w-lg space-y-4 rounded-lg bg-white p-5 shadow-xl"
          >
            <div>
              <h3 className="font-semibold text-slate-900">Duplicate listing</h3>
              <p className="mt-0.5 text-sm text-slate-500">
                A copy of <span className="font-medium text-slate-700">{name}</span> ({sku}). Details, pricing, GST, specs
                and SEO come across. Stock starts at 0.
              </p>
            </div>

            {err && <div className="notice-red">{err}</div>}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">New SKU</label>
                <input className="input font-mono" value={newSku} onChange={(e) => setNewSku(e.target.value)} required autoFocus />
              </div>
              <div>
                <label className="label">Create as</label>
                <select className="input" value={status} onChange={(e) => setStatus(e.target.value as 'draft' | 'active')}>
                  <option value="draft">Draft — review before it goes live</option>
                  <option value="active">Active — on the site straight away</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label">Name</label>
                <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} required />
              </div>
            </div>

            <div className="space-y-2 text-sm">
              <label className="flex cursor-pointer items-start gap-2">
                <input type="checkbox" className="mt-1" checked={withImages} onChange={(e) => setWithImages(e.target.checked)} />
                <span>
                  <span className="font-medium text-slate-800">Copy the pictures</span>
                  <span className="block text-xs text-slate-500">Links to the same Cloudinary files — nothing is re-uploaded.</span>
                </span>
              </label>
              <label className={`flex items-start gap-2 ${variantCount ? 'cursor-pointer' : 'opacity-50'}`}>
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={withVariants && variantCount > 0}
                  disabled={variantCount === 0}
                  onChange={(e) => setWithVariants(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-slate-800">
                    Copy the {variantCount} variant{variantCount === 1 ? '' : 's'}
                  </span>
                  <span className="block text-xs text-slate-500">
                    Variant SKUs that start with {sku} are re-based on the new SKU; other full SKUs get the new SKU in
                    front so they stay unique. Their stock starts at 0 too.
                  </span>
                </span>
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" className="btn-outline" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={busy || !newSku.trim() || !newName.trim()}>
                {busy ? 'Creating…' : 'Create copy'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
