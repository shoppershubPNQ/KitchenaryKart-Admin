/**
 * Variant image upload.
 *
 * POST   multipart/form-data with field `file` — uploads to Cloudinary
 *        under kk/<parent-sku>/variant-<id>/ and sets
 *        ProductVariant.imageUrl to the secure_url. Returns the URL
 *        so the UI can render a preview immediately.
 *
 * DELETE clears imageUrl on the variant + best-effort removes the
 *        Cloudinary asset.
 */
import { NextRequest } from 'next/server';
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

export const POST = withAuth(async (req: NextRequest, { params }) => {
  try {
    const id = parseInt(params.id);
    const variant = await prisma.productVariant.findUnique({
      where: { id },
      include: { product: { select: { sku: true } } },
    });
    if (!variant) return fail('Variant not found', 404);

    const form = await req.formData();
    const f = form.get('file');
    if (!(f instanceof File)) return fail('No file uploaded', 400);
    if (f.size > MAX_BYTES) return fail(`File too large (max 10 MB)`, 400);
    if (!ALLOWED_TYPES.has(f.type)) return fail(`Unsupported file type: ${f.type || f.name}`, 400);

    const sku = safeSku(variant.product.sku);
    const buf = Buffer.from(await f.arrayBuffer());
    const stamp = Date.now().toString(36);
    const { url } = await uploadBuffer(buf, {
      folder: `kk/${sku}/variant-${id}`,
      publicIdPrefix: stamp,
    });

    const updated = await prisma.productVariant.update({
      where: { id },
      data: { imageUrl: url },
      select: { id: true, imageUrl: true },
    });

    return ok({ imageUrl: updated.imageUrl });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);

export const DELETE = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    const variant = await prisma.productVariant.findUnique({ where: { id } });
    if (!variant) return fail('Variant not found', 404);

    // Best-effort Cloudinary cleanup
    if (variant.imageUrl && process.env.CLOUDINARY_URL) {
      const m = variant.imageUrl.match(/\/upload\/(?:[^/]+\/)*([^/]+\/[^/.]+)\.[a-z0-9]+$/i);
      if (m) {
        try {
          cloudinary.config({ secure: true });
          await cloudinary.uploader.destroy(m[1]);
        } catch (err) {
          // Don't fail the request if Cloudinary cleanup hiccups —
          // the DB record is the source of truth for the storefront.
          console.error('[variant-image] Cloudinary destroy failed:', err);
        }
      }
    }

    const updated = await prisma.productVariant.update({
      where: { id },
      data: { imageUrl: null },
      select: { id: true, imageUrl: true },
    });
    return ok({ imageUrl: updated.imageUrl });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);
