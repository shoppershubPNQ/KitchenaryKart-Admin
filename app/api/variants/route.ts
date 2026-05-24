/**
 * Cross-product variant listing.
 *
 * GET /api/variants?search=&category=&lowStock=&missingImage=&limit=&offset=
 *
 * Powers the /dashboard/variants flat table — admin can see every
 * variant across the catalog at once for inventory + pricing work.
 * Per-row edits still go through the existing /api/variants/[id]
 * PATCH + /api/variants/[id]/image endpoints.
 */
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok, paging } from '@/lib/api';

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const { limit, offset } = paging(url);
    const search = url.searchParams.get('search')?.trim();
    const category = url.searchParams.get('category')?.trim();
    const lowStock = url.searchParams.get('lowStock') === '1';
    const missingImage = url.searchParams.get('missingImage') === '1';

    const where: Prisma.ProductVariantWhereInput = {};

    if (search) {
      // Match parent SKU, parent name, variant SKU suffix, or
      // variant value. Lets admins paste any of those identifiers
      // and find the row.
      where.OR = [
        { skuSuffix: { contains: search, mode: 'insensitive' } },
        { variantValue: { contains: search, mode: 'insensitive' } },
        { product: { sku: { contains: search, mode: 'insensitive' } } },
        { product: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (category) where.product = { ...(where.product as object), category };
    if (lowStock) where.stock = { lte: 5 };
    if (missingImage) where.imageUrl = null;

    const [items, total] = await Promise.all([
      prisma.productVariant.findMany({
        where,
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              category: true,
              subcategory: true,
              price: true,
              mrp: true,
              status: true,
            },
          },
        },
        orderBy: [{ product: { name: 'asc' } }, { variantValue: 'asc' }],
        take: limit,
        skip: offset,
      }),
      prisma.productVariant.count({ where }),
    ]);

    return ok({ variants: items, total, limit, offset });
  } catch (e) {
    return handleError(e);
  }
});
