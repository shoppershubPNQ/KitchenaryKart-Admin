/**
 * GET /api/subcategories — flat list of every distinct subcategory in the
 * catalog, with its parent category and the product count. Used by the
 * Banner 2 editor to populate the link-target dropdown.
 */
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';

export const GET = withAuth(async () => {
  try {
    const groups = await prisma.product.groupBy({
      by: ['category', 'subcategory'],
      where: {
        status: 'active',
        category: { not: null },
        subcategory: { not: null },
      },
      _count: { _all: true },
      orderBy: [{ category: 'asc' }, { subcategory: 'asc' }],
    });
    const subcategories = groups
      .filter((g) => g.subcategory)
      .map((g) => ({
        category: g.category as string,
        subcategory: g.subcategory as string,
        count: g._count._all,
      }));
    return ok({ subcategories });
  } catch (e) {
    return handleError(e);
  }
});
