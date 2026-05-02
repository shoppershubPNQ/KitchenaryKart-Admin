/**
 * Single-collection update.
 *
 * PATCH /api/collections/:slug
 * Body: { subcategories: string[], isActive?: boolean, name?: string }
 *
 * After saving, fires a fire-and-forget cache-bust to the storefront so the
 * Best Seller / New Arrival tabs update immediately.
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { revalidateWeb } from '@/lib/revalidateWeb';

const updateSchema = z.object({
  subcategories: z.array(z.string()).optional(),
  productSkus: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  name: z.string().optional(),
});

export const GET = withAuth(async (_req, { params }) => {
  try {
    const c = await prisma.collection.findUnique({ where: { slug: params.slug } });
    if (!c) return fail('Not found', 404);
    return ok({ collection: c });
  } catch (e) {
    return handleError(e);
  }
});

export const PATCH = withAuth(async (req, { params }) => {
  try {
    const body = updateSchema.parse(await req.json());
    const data: any = {};
    if (body.subcategories !== undefined) data.subcategories = body.subcategories;
    if (body.productSkus !== undefined) data.productSkus = body.productSkus;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.name !== undefined) data.name = body.name;

    const c = await prisma.collection.update({
      where: { slug: params.slug },
      data,
    });
    await revalidateWeb('collections');
    return ok({ collection: c });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);
