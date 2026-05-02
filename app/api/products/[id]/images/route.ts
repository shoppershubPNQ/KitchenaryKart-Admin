/**
 * Product image management.
 *
 * Files are written to ../website/images/{sku}/ (relative to the admin project root)
 * so they're served directly by the static website at /images/{sku}/...
 */
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';

// Admin's cwd when `next dev` runs; website lives one level up.
const IMAGES_ROOT = path.resolve(process.cwd(), '..', 'website', 'images');
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file

function safeSku(sku: string): string {
  // Defence in depth — SKUs in the DB shouldn't contain slashes, but guard anyway.
  return sku.replace(/[^A-Za-z0-9._-]/g, '_');
}
function publicUrl(sku: string, file: string): string {
  return `/images/${encodeURIComponent(sku)}/${file}`;
}
function nextFilename(dir: string, ext: string): string {
  let max = 0;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      const n = parseInt(f);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${max + 1}${ext}`;
}

/** List images for a product (returned via the main product GET; this is here for convenience). */
export const GET = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    const product = await prisma.product.findUnique({
      where: { id },
      select: { sku: true, imageUrl: true, images: true },
    });
    if (!product) return fail('Not found', 404);
    return ok({
      sku: product.sku,
      imageUrl: product.imageUrl,
      images: (product.images as string[] | null) || [],
    });
  } catch (e) {
    return handleError(e);
  }
});

/** Upload one or more new images. Multipart form-data with field `files`. */
export const POST = withAuth(async (req, { params }) => {
  try {
    const id = parseInt(params.id);
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return fail('Not found', 404);

    const form = await req.formData();
    const files: File[] = [];
    for (const v of form.getAll('files')) {
      if (v instanceof File) files.push(v);
    }
    if (files.length === 0) return fail('No files uploaded', 400);

    const sku = safeSku(product.sku);
    const dir = path.join(IMAGES_ROOT, sku);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const newUrls: string[] = [];
    for (const f of files) {
      if (f.size > MAX_BYTES) return fail(`File too large: ${f.name} (max 10 MB)`, 400);
      const ext = path.extname(f.name).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) return fail(`Unsupported file type: ${ext || f.name}`, 400);
      const fname = nextFilename(dir, ext);
      const full = path.join(dir, fname);
      const buf = Buffer.from(await f.arrayBuffer());
      fs.writeFileSync(full, buf);
      newUrls.push(publicUrl(product.sku, fname));
    }

    const currentImages = (product.images as string[] | null) || [];
    const updatedImages = [...currentImages, ...newUrls];
    const updated = await prisma.product.update({
      where: { id },
      data: {
        images: updatedImages as any,
        imageUrl: product.imageUrl || updatedImages[0] || null,
      },
      select: { imageUrl: true, images: true },
    });

    return ok({
      added: newUrls,
      imageUrl: updated.imageUrl,
      images: updated.images,
    });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);

const deleteSchema = z.object({ url: z.string().min(1) });

/** Remove one image (by its URL). Deletes the file from disk and updates the DB. */
export const DELETE = withAuth(async (req, { params }) => {
  try {
    const id = parseInt(params.id);
    const body = deleteSchema.parse(await req.json());

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return fail('Not found', 404);

    const images = ((product.images as string[] | null) || []).filter(u => u !== body.url);
    const imageUrl = product.imageUrl === body.url ? (images[0] || null) : product.imageUrl;

    // Best-effort file removal. URL format: /images/{sku}/{file}
    const m = body.url.match(/^\/images\/([^/]+)\/([^/]+)$/);
    if (m) {
      const full = path.join(IMAGES_ROOT, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
      try { fs.unlinkSync(full); } catch (err: any) {
        if (err?.code !== 'ENOENT') console.warn('Failed to remove image file:', full, err?.code);
      }
    }

    const updated = await prisma.product.update({
      where: { id },
      data: { images: images as any, imageUrl },
      select: { imageUrl: true, images: true },
    });
    return ok({ imageUrl: updated.imageUrl, images: updated.images });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);

const reorderSchema = z.object({ images: z.array(z.string().min(1)) });

/** Reorder images. First entry becomes `imageUrl` (main). */
export const PATCH = withAuth(async (req, { params }) => {
  try {
    const id = parseInt(params.id);
    const body = reorderSchema.parse(await req.json());
    const updated = await prisma.product.update({
      where: { id },
      data: {
        images: body.images as any,
        imageUrl: body.images[0] || null,
      },
      select: { imageUrl: true, images: true },
    });
    return ok({ imageUrl: updated.imageUrl, images: updated.images });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);
