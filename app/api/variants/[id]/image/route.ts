/**
 * Variant image management — mirrors the Product image flow.
 *
 * GET    list current variant images.
 * POST   multipart/form-data with field `files` (one or more) —
 *        uploads each to Cloudinary under
 *        kk/<parent-sku>/variant-<id>/, appends to ProductVariant.images,
 *        sets imageUrl to the first when not already set. Returns the
 *        updated images[] + imageUrl so the UI can render previews.
 * DELETE body { url } — removes one image from the array + best-effort
 *        Cloudinary destroy. If the removed URL was the primary
 *        imageUrl, promotes the next image to primary (or null).
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { v2 as cloudinary } from 'cloudinary';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { uploadBuffer } from '@/lib/cloudinary-upload';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 10 * 1024 * 1024;

function safeSku(sku: string): string {
  return sku.replace(/[^A-Za-z0-9._-]/g, '_');
}

export const GET = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    const v = await prisma.productVariant.findUnique({
      where: { id },
      select: { id: true, imageUrl: true, images: true },
    });
    if (!v) return fail('Variant not found', 404);
    return ok({
      imageUrl: v.imageUrl,
      images: (v.images as string[] | null) || [],
    });
  } catch (e) {
    return handleError(e);
  }
});

export const POST = withAuth(async (req: NextRequest, { params }) => {
  try {
    const id = parseInt(params.id);
    const variant = await prisma.productVariant.findUnique({
      where: { id },
      include: { product: { select: { sku: true } } },
    });
    if (!variant) return fail('Variant not found', 404);

    const form = await req.formData();
    // Accept either `files` (multi-upload) or `file` (legacy single)
    const raw = [...form.getAll('files'), ...form.getAll('file')];
    const files: File[] = raw.filter((v): v is File => v instanceof File);
    if (files.length === 0) return fail('No file uploaded', 400);

    const sku = safeSku(variant.product.sku);
    const newUrls: string[] = [];
    for (const f of files) {
      if (f.size > MAX_BYTES) return fail(`File too large: ${f.name} (max 10 MB)`, 400);
      if (!ALLOWED_TYPES.has(f.type)) return fail(`Unsupported file type: ${f.type || f.name}`, 400);
      const buf = Buffer.from(await f.arrayBuffer());
      const stamp = Date.now().toString(36);
      const { url } = await uploadBuffer(buf, {
        folder: `kk/${sku}/variant-${id}`,
        publicIdPrefix: stamp,
      });
      newUrls.push(url);
    }

    const existing = (variant.images as string[] | null) || [];
    const merged = [...existing, ...newUrls];

    const updated = await prisma.productVariant.update({
      where: { id },
      data: {
        images: merged as any,
        // Keep imageUrl in sync with the first image so the storefront
        // shop-card thumbnail (which reads imageUrl, not images[0])
        // updates automatically the first time an image is uploaded.
        imageUrl: variant.imageUrl || merged[0] || null,
      },
      select: { id: true, imageUrl: true, images: true },
    });

    return ok({
      added: newUrls,
      imageUrl: updated.imageUrl,
      images: (updated.images as string[] | null) || [],
    });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);

const deleteSchema = z.object({ url: z.string().min(1) });

export const DELETE = withAuth(async (req, { params }) => {
  try {
    const id = parseInt(params.id);
    const variant = await prisma.productVariant.findUnique({ where: { id } });
    if (!variant) return fail('Variant not found', 404);

    // Backward compat: body-less DELETE clears the primary imageUrl
    // and the entire images array (matches old single-image behaviour).
    let removeUrl: string | null = null;
    try {
      const body = await req.json();
      removeUrl = deleteSchema.parse(body).url;
    } catch {
      removeUrl = null; // no body -> clear everything
    }

    const existing = (variant.images as string[] | null) || [];
    const nextImages = removeUrl
      ? existing.filter((u) => u !== removeUrl)
      : [];
    const nextPrimary = removeUrl
      ? variant.imageUrl === removeUrl
        ? nextImages[0] || null
        : variant.imageUrl
      : null;

    // Best-effort Cloudinary cleanup
    const urlsToDestroy = removeUrl
      ? [removeUrl]
      : [variant.imageUrl, ...existing].filter((u): u is string => !!u);
    if (urlsToDestroy.length > 0 && process.env.CLOUDINARY_URL) {
      cloudinary.config({ secure: true });
      for (const u of urlsToDestroy) {
        const m = u.match(/\/upload\/(?:[^/]+\/)*([^/]+\/[^/.]+)\.[a-z0-9]+$/i);
        if (!m) continue;
        try {
          await cloudinary.uploader.destroy(m[1]);
        } catch (err) {
          console.error('[variant-image] Cloudinary destroy failed:', err);
        }
      }
    }

    const updated = await prisma.productVariant.update({
      where: { id },
      data: { imageUrl: nextPrimary, images: nextImages as any },
      select: { id: true, imageUrl: true, images: true },
    });
    return ok({
      imageUrl: updated.imageUrl,
      images: (updated.images as string[] | null) || [],
    });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);
