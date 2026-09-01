/**
 * POST /api/products/merge — fold one listing into another.
 *
 * This catalogue keeps growing near-duplicate listings: the same product
 * arriving twice from an import, a size that had to be created as its own
 * product because the family did not have that variant yet (the Gold+SS
 * steamer 34/36cm), 357 skus that exist as BOTH a parent and a variant. Each
 * one splits its stock, its reviews and its search relevance in two.
 *
 * The source is NEVER deleted. Deleting it would:
 *   - break InventoryMovement (a required relation — the delete would fail), and
 *   - null out the product on historic OrderItems, destroying what was sold.
 * It is discontinued (or drafted) instead: off the storefront, history intact.
 *
 * Body:
 *   sourceId, targetId   the listing to fold in, and the one to keep
 *   moveVariants         move the source's variant rows to the target (default true)
 *   sourceAsVariant      {variantType, variantValue} — also turn the source
 *                        product ITSELF into a variant of the target, carrying
 *                        its sku, price, stock and image across
 *   sourceStatus         'discontinued' (default) | 'draft'
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { revalidateWeb } from '@/lib/revalidateWeb';
import { invalidateAdminSearchIndex } from '@/lib/product-search-index';

const schema = z.object({
  sourceId: z.number().int().positive(),
  targetId: z.number().int().positive(),
  moveVariants: z.boolean().optional(),
  sourceAsVariant: z
    .object({
      variantType: z.string().trim().min(1).max(40),
      variantValue: z.string().trim().min(1).max(80),
    })
    .nullable()
    .optional(),
  sourceStatus: z.enum(['discontinued', 'draft']).optional(),
});

export const POST = withAuth(async (req) => {
  try {
    const body = schema.parse(await req.json());
    const { sourceId, targetId } = body;
    const moveVariants = body.moveVariants ?? true;
    const sourceStatus = body.sourceStatus ?? 'discontinued';

    if (sourceId === targetId) return fail('Source and target are the same product', 400);

    const [source, target] = await Promise.all([
      prisma.product.findUnique({
        where: { id: sourceId },
        select: {
          id: true, sku: true, name: true, price: true, mrp: true, stock: true,
          imageUrl: true, images: true, weight: true, capacity: true, power: true, dimensions: true,
          taxPercent: true, hsnCode: true,
          variants: { select: { id: true, skuSuffix: true, variantValue: true } },
        },
      }),
      prisma.product.findUnique({
        where: { id: targetId },
        select: {
          id: true, sku: true, name: true, taxPercent: true, hsnCode: true,
          variants: { select: { skuSuffix: true } },
        },
      }),
    ]);
    if (!source) return fail('Source product not found', 404);
    if (!target) return fail('Target product not found', 404);

    // A sku may exist only once across the target's variants, or the storefront
    // would resolve one of them arbitrarily.
    const targetSkus = new Set(target.variants.map((v) => v.skuSuffix).filter(Boolean) as string[]);
    const incoming: string[] = [];
    if (moveVariants) incoming.push(...(source.variants.map((v) => v.skuSuffix).filter(Boolean) as string[]));
    if (body.sourceAsVariant) incoming.push(source.sku);
    const clash = incoming.filter((s) => targetSkus.has(s));
    if (clash.length) {
      return fail(`Refusing: these skus already exist on the target — ${clash.join(', ')}`, 409);
    }

    // Different GST rates would silently re-tax the moved rows: a variant takes
    // its rate from the parent it now hangs off.
    const warnings: string[] = [];
    if (Number(source.taxPercent) !== Number(target.taxPercent)) {
      warnings.push(
        `GST differs — source ${source.taxPercent}% vs target ${target.taxPercent}%. The moved rows now bill at ${target.taxPercent}%.`,
      );
    }
    if ((source.hsnCode ?? '') !== (target.hsnCode ?? '')) {
      warnings.push(`HSN differs — source ${source.hsnCode ?? '(blank)'} vs target ${target.hsnCode ?? '(blank)'}.`);
    }

    const ops: any[] = [];
    if (moveVariants && source.variants.length) {
      ops.push(
        prisma.productVariant.updateMany({
          where: { productId: sourceId },
          data: { productId: targetId },
        }),
      );
    }
    if (body.sourceAsVariant) {
      const gallery = Array.isArray(source.images) ? (source.images as string[]) : [];
      ops.push(
        prisma.productVariant.create({
          data: {
            productId: targetId,
            variantType: body.sourceAsVariant.variantType,
            variantValue: body.sourceAsVariant.variantValue,
            skuSuffix: source.sku,
            price: source.price,
            mrp: source.mrp,
            stock: source.stock,
            imageUrl: source.imageUrl,
            images: gallery.length ? (gallery as any) : undefined,
            weight: source.weight,
            capacity: source.capacity,
            power: source.power,
            dimensions: source.dimensions,
          },
        }),
      );
    }
    // Retire the source: off the storefront, and its own stock zeroed so the
    // same units are not counted twice now that they live on the target.
    ops.push(
      prisma.product.update({
        where: { id: sourceId },
        data: { status: sourceStatus, stock: 0 },
      }),
    );

    await prisma.$transaction(ops);
    invalidateAdminSearchIndex();
    try { await revalidateWeb('products'); } catch { /* the merge is saved either way */ }

    return ok({
      merged: true,
      source: { id: source.id, sku: source.sku, name: source.name, nowStatus: sourceStatus },
      target: { id: target.id, sku: target.sku, name: target.name },
      variantsMoved: moveVariants ? source.variants.length : 0,
      sourceAddedAsVariant: !!body.sourceAsVariant,
      warnings,
    });
  } catch (e) {
    if (e instanceof z.ZodError) return fail(e.issues[0]?.message ?? 'Bad request', 400);
    return handleError(e);
  }
}, ['admin']);
