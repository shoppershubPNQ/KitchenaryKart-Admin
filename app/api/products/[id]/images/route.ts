/**
 * Product image management.
 *
 * Files are uploaded to Cloudinary under `kk/<sku>/` and the secure_url is
 * stored in `Product.images` (array) and `Product.imageUrl` (primary). The
 * old admin used to write to a sibling `website/images/{sku}/` folder, but
 * that doesn't work on Vercel — see lib/cloudinary-upload.ts for context.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { v2 as cloudinary } from 'cloudinary';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { uploadBuffer } from '@/lib/cloudinary-upload';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file

function safeSku(sku: string): string {
  // Defence in depth — SKUs in the DB shouldn't contain slashes, but guard anyway.
  return sku.replace(/[^A-Za-z0-9._-]/g, '_');
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
    const newUrls: string[] = [];
    for (const f of files) {
      if (f.size > MAX_BYTES) return fail(`File too large: ${f.name} (max 10 MB)`, 400);
      if (!ALLOWED_TYPES.has(f.type)) return fail(`Unsupported file type: ${f.type || f.name}`, 400);

      const buf = Buffer.from(await f.arrayBuffer());
      const stamp = Date.now().toString(36);
      const { url } = await uploadBuffer(buf, {
        folder: `kk/${sku}`,
        publicIdPrefix: stamp,
      });
      newUrls.push(url);
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

/** Remove one image (by its URL). Updates the DB and removes from Cloudinary. */
export const DELETE = withAuth(async (req, { params }) => {
  try {
    const id = parseInt(params.id);
    const body = deleteSchema.parse(await req.json());

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return fail('Not found', 404);

    const images = ((product.images as string[] | null) || []).filter((u) => u !== body.url);
    const imageUrl = product.imageUrl === body.url ? (images[0] || null) : product.imageUrl;

    // Best-effort Cloudinary deletion. Only attempt if the URL looks like a
    // Cloudinary asset we own — old `/images/<sku>/<file>` paths were served
    // by a redirect route, so the underlying asset is still accessed but the
    // DB never stored its public_id.
    const m = body.url.match(/\/upload\/(?:[^/]+\/)*([^/]+\/[^/.]+)\.[a-z0-9]+$/i);
    if (m && process.env.CLOUDINARY_URL) {
      try {
        cloudinary.config({ secure: true });
        await cloudinary.uploader.destroy(m[1]);
      } catch (err: any) {
        console.warn('Failed to delete Cloudinary asset:', m[1], err?.message);
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
