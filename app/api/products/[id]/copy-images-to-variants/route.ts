/**
 * POST /api/products/:id/copy-images-to-variants
 *
 * Copies the PARENT product's gallery down onto its variants.
 *
 * Why this exists: a variant with no image of its own falls back to the parent
 * on the storefront, but several surfaces read the variant row directly — the
 * Meta/Google feeds, the listing cards, the admin panel — and those printed a
 * blank. Setting the image on each variant makes every surface agree.
 *
 * Default is `missingOnly`: variants that already carry their own photo are
 * left alone, because a size-specific or colour-specific shot is BETTER than
 * the parent's and must not be overwritten. Pass overwrite:true to force.
 *
 * Body: { overwrite?: boolean }
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { revalidateWeb } from '@/lib/revalidateWeb';

const schema = z.object({ overwrite: z.boolean().optional() });

export const POST = withAuth(async (req, { params }) => {
  try {
    const id = parseInt(params.id);
    if (!Number.isFinite(id)) return fail('Bad id', 400);
    const { overwrite = false } = schema.parse(await req.json().catch(() => ({})));

    const product = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true, name: true, imageUrl: true, images: true,
        variants: { select: { id: true, skuSuffix: true, imageUrl: true, images: true } },
      },
    });
    if (!product) return fail('Product not found', 404);
    if (!product.variants.length) return fail('This product has no variants', 400);

    const gallery = Array.isArray(product.images) ? (product.images as string[]) : [];
    const primary = product.imageUrl ?? gallery[0] ?? null;
    if (!primary) return fail('This product has no image to copy', 400);

    const targets = overwrite
      ? product.variants
      : product.variants.filter(
          (v) => !v.imageUrl && !(Array.isArray(v.images) && (v.images as string[]).length > 0),
        );

    if (!targets.length) {
      return ok({ updated: 0, skipped: product.variants.length, message: 'Every variant already has its own photo' });
    }

    await prisma.$transaction(
      targets.map((v) =>
        prisma.productVariant.update({
          where: { id: v.id },
          data: { imageUrl: primary, images: gallery.length ? (gallery as any) : undefined },
        }),
      ),
    );

    try { await revalidateWeb('products'); } catch { /* stock/image is saved either way */ }

    return ok({
      updated: targets.length,
      skipped: product.variants.length - targets.length,
      imageUrl: primary,
      galleryCount: gallery.length,
    });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);
