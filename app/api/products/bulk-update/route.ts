/**
 * POST /api/products/bulk-update
 *
 * Applies one change to many selected products at once — the products list had
 * no bulk action at all, so taking 40 items out of stock or moving a batch to
 * draft meant 40 separate edits.
 *
 * Deliberately NARROW: status, stock, reorder point and the two merchandising
 * flags. Price is NOT bulk-editable here — a mis-clicked bulk price would be
 * live money, and it needs the per-product screen where the GST breakdown is
 * visible.
 *
 * `stock` writes the SAME number to every selected product (a count, not a
 * delta) — matching how the shipment lists are reconciled.
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { revalidateWeb } from '@/lib/revalidateWeb';
import { invalidateAdminSearchIndex } from '@/lib/product-search-index';

const schema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  data: z
    .object({
      status: z.enum(['active', 'draft', 'discontinued']).optional(),
      stock: z.number().int().nonnegative().optional(),
      reorderPoint: z.number().int().nonnegative().optional(),
      isBestseller: z.boolean().optional(),
      isNewArrival: z.boolean().optional(),
      /** Also push the stock down to every variant of the selected products. */
      applyStockToVariants: z.boolean().optional(),
    })
    .refine((d) => Object.keys(d).some((k) => k !== 'applyStockToVariants'), {
      message: 'Nothing to update',
    }),
});

export const POST = withAuth(async (req) => {
  try {
    const { ids, data } = schema.parse(await req.json());
    const { applyStockToVariants, ...fields } = data;

    const result = await prisma.product.updateMany({
      where: { id: { in: ids } },
      data: fields,
    });

    let variantsUpdated = 0;
    if (applyStockToVariants && fields.stock != null) {
      const v = await prisma.productVariant.updateMany({
        where: { productId: { in: ids } },
        data: { stock: fields.stock },
      });
      variantsUpdated = v.count;
    }

    invalidateAdminSearchIndex();
    // Stock / status drive what the storefront shows, so refresh it now rather
    // than leaving the change invisible for the ISR window.
    try {
      await revalidateWeb('products');
    } catch {
      // Never fail the write because revalidation is unreachable.
    }

    return ok({ updated: result.count, variantsUpdated });
  } catch (e) {
    if (e instanceof z.ZodError) return fail(e.issues[0]?.message ?? 'Bad request', 400);
    return handleError(e);
  }
}, ['admin', 'sales']);
