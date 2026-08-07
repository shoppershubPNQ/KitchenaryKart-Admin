/**
 * Business categories — list + create.
 *
 * GET  returns every business category with its LIVE resolved product count
 *      (picked SKUs that are still active), plus a flat product list for the
 *      picker.
 * POST creates one.
 *
 * The count is computed through lib/business-categories so it always matches
 * what the storefront will actually render.
 */
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok, fail } from '@/lib/api';
import { countProducts, toSkuList } from '@/lib/business-categories';
import { z } from 'zod';

const createSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lower-case words separated by hyphens'),
  description: z.string().trim().optional().nullable(),
  imageUrl: z.string().trim().optional().nullable(),
  metaTitle: z.string().trim().optional().nullable(),
  metaDescription: z.string().trim().optional().nullable(),
  productSkus: z.array(z.string()).default([]),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const GET = withAuth(async () => {
  try {
    const [rows, products] = await Promise.all([
      prisma.businessCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      prisma.product.findMany({
        where: { status: 'active' },
        select: { sku: true, name: true, category: true, subcategory: true, imageUrl: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const categories = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        productSkus: toSkuList(r.productSkus),
        productCount: await countProducts(r.productSkus),
      })),
    );

    return ok({ categories, products });
  } catch (e) {
    return handleError(e);
  }
});

export const POST = withAuth(async (req) => {
  try {
    const body = createSchema.parse(await req.json());
    const clash = await prisma.businessCategory.findUnique({ where: { slug: body.slug } });
    if (clash) return fail(`Slug "${body.slug}" is already used by "${clash.name}"`, 409);

    const created = await prisma.businessCategory.create({
      data: { ...body, productSkus: toSkuList(body.productSkus) } as any,
    });
    return ok(created, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
});
