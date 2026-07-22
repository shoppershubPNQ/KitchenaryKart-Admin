'use client';

import { useRef, useState } from 'react';

const IMG_BASE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:5500';
function srcFor(url: string): string {
  if (/^https?:/i.test(url)) return url;
  return IMG_BASE + url;
}

interface Props {
  productId: number;
  sku: string;
  imageUrl: string | null;
  images: string[];
}

/**
 * Image manager: upload, delete, reorder, set main.
 * Uploads go through POST /api/products/[id]/images; other ops via PATCH/DELETE.
 */
export function ProductImages({ productId, sku, imageUrl: initialMain, images: initialImages }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<string[]>(initialImages || (initialMain ? [initialMain] : []));
  const [main, setMain] = useState<string | null>(initialMain);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const dragIndex = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Bulk upload sends each file in its OWN request (sequentially). The API
  // appends to the image list, so parallel requests would race and lose images
  // — hence the await-in-loop. One-file-per-request also keeps every request
  // under the hosting body-size limit, so a big batch never fails as a single
  // oversized "Request Entity Too Large" (413) response.
  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErr(null);
    const list = Array.from(files);
    const failed: string[] = [];
    setBusy('upload');
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (list.length > 1) setProgress(`Uploading ${i + 1} of ${list.length}…`);
      try {
        const form = new FormData();
        form.append('files', f);
        const res = await fetch(`/api/products/${productId}/images`, {
          method: 'POST',
          body: form,
          credentials: 'include',
        });
        if (!res.ok) {
          // A 413 (body too large) returns non-JSON text, which would blow up
          // res.json() with "Unexpected token …". Read defensively.
          let msg = `Upload failed (${res.status})`;
          try { const d = await res.json(); msg = d.error || msg; }
          catch { if (res.status === 413) msg = `too large for a single upload (compress to a few MB)`; }
          throw new Error(msg);
        }
        const data = await res.json();
        setImages(data.images);
        setMain(data.imageUrl);
      } catch (e: any) {
        failed.push(`${f.name}: ${e.message}`);
      }
    }
    setBusy(null);
    setProgress(null);
    if (fileInput.current) fileInput.current.value = '';
    if (failed.length) {
      setErr(`${failed.length} of ${list.length} failed — ${failed.join('; ')}`);
    }
  }

  async function remove(url: string) {
    if (!confirm('Remove this image?')) return;
    setErr(null);
    setBusy(url);
    try {
      const res = await fetch(`/api/products/${productId}/images`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setImages(data.images);
      setMain(data.imageUrl);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function setAsMain(url: string) {
    setErr(null);
    setBusy(url);
    try {
      const reordered = [url, ...images.filter(u => u !== url)];
      const res = await fetch(`/api/products/${productId}/images`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: reordered }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reorder failed');
      setImages(data.images);
      setMain(data.imageUrl);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  // Persist a drag-reordered list. Optimistic: update the UI immediately, then
  // PATCH; on failure revert to the previous order. First entry becomes main.
  async function persistOrder(next: string[]) {
    const prevImages = images;
    const prevMain = main;
    setImages(next);
    setMain(next[0] ?? null);
    setErr(null);
    setBusy('reorder');
    try {
      const res = await fetch(`/api/products/${productId}/images`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: next }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reorder failed');
      setImages(data.images);
      setMain(data.imageUrl);
    } catch (e: any) {
      setImages(prevImages);
      setMain(prevMain);
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  function handleDrop(target: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    setDragOver(null);
    if (from == null || from === target || busy) return;
    const next = [...images];
    const [moved] = next.splice(from, 1);
    next.splice(target, 0, moved);
    persistOrder(next);
  }

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Images</div>
          <p className="text-xs text-slate-400 mt-0.5">
            {images.length === 0
              ? 'No images yet.'
              : `${images.length} image${images.length === 1 ? '' : 's'} · drag to reorder · first is the main shown in the shop.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.gif"
            multiple
            className="hidden"
            onChange={e => upload(e.target.files)}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={busy === 'upload'}
            onClick={() => fileInput.current?.click()}
          >
            {busy === 'upload' ? (progress || 'Uploading…') : '+ Upload images'}
          </button>
        </div>
      </div>

      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}

      {images.length === 0 ? (
        <div className="border-2 border-dashed border-slate-200 rounded-lg p-10 text-center text-sm text-slate-400">
          Click <b>Upload images</b> above to add photos (JPG, PNG, WebP — up to 10 MB each).
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {images.map((url, i) => {
            const isMain = url === main;
            return (
              <div
                key={url}
                draggable={!busy}
                onDragStart={() => { dragIndex.current = i; }}
                onDragOver={(e) => { e.preventDefault(); if (dragOver !== i) setDragOver(i); }}
                onDragLeave={() => setDragOver((d) => (d === i ? null : d))}
                onDrop={() => handleDrop(i)}
                onDragEnd={() => { dragIndex.current = null; setDragOver(null); }}
                className={`relative group border rounded-md overflow-hidden bg-slate-50 transition ${
                  busy ? '' : 'cursor-grab active:cursor-grabbing'
                } ${
                  dragOver === i ? 'border-brand ring-2 ring-brand/50' : 'border-slate-200'
                } ${dragIndex.current === i ? 'opacity-50' : ''}`}
              >
                <div className="aspect-square flex items-center justify-center">
                  {/* draggable=false + pointer-events-none so the tile (not the
                      browser's native image drag) owns the reorder gesture. */}
                  <img src={srcFor(url)} alt={`${sku} ${i + 1}`} draggable={false} className="w-full h-full object-contain pointer-events-none" />
                </div>
                {/* Order index — makes the gallery order explicit while dragging. */}
                <div className="absolute top-1.5 right-1.5 bg-black/55 text-white text-[10px] font-semibold w-5 h-5 grid place-items-center rounded-full">{i + 1}</div>
                {isMain && (
                  <div className="absolute top-1.5 left-1.5 bg-brand text-white text-[10px] font-semibold px-2 py-0.5 rounded">MAIN</div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-xs flex opacity-0 group-hover:opacity-100 transition-opacity">
                  {!isMain && (
                    <button
                      type="button"
                      className="flex-1 py-1.5 hover:bg-white/10"
                      disabled={busy === url}
                      onClick={() => setAsMain(url)}
                    >
                      Set main
                    </button>
                  )}
                  <button
                    type="button"
                    className="flex-1 py-1.5 hover:bg-red-600"
                    disabled={busy === url}
                    onClick={() => remove(url)}
                  >
                    {busy === url ? '…' : 'Delete'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
