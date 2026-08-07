/**
 * Business category — update / delete one.
 *
 * Deleting is safe: membership is computed from rules, so removing a category
 * never touches a product row. Only the grouping disappears.
 */
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok, fail } from '@/lib/api';
import { countProducts, rulesOf } from '@/lib/business-categories';
import { z } from 'zod';

const patchSchema = z.object({
  name: z.string().trim().min(2).optional(),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lower-case words separated by hyphens').optional(),
  description: z.string().trim().nullable().optional(),
  imageUrl: z.string().trim().nullable().optional(),
  metaTitle: z.string().trim().nullable().optional(),
  metaDescription: z.string().trim().nullable().optional(),
  subcategories: z.array(z.string()).optional(),
  productSkus: z.array(z.string()).optional(),
  excludeSkus: z.array(z.string()).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const PATCH = withAuth(async (req, { params }) => {
  try {
    const id = parseInt(params.id);
    if (!Number.isFinite(id)) return fail('Bad id', 400);

    const existing = await prisma.businessCategory.findUnique({ where: { id } });
    if (!existing) return fail('Not found', 404);

    const body = patchSchema.parse(await req.json());

    if (body.slug && body.slug !== existing.slug) {
      const clash = await prisma.businessCategory.findUnique({ where: { slug: body.slug } });
      if (clash) return fail(`Slug "${body.slug}" is already used by "${clash.name}"`, 409);
    }

    const updated = await prisma.businessCategory.update({ where: { id }, data: body as any });
    return ok({ ...updated, productCount: await countProducts(rulesOf(updated)) });
  } catch (e) {
    return handleError(e);
  }
});

export const DELETE = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    if (!Number.isFinite(id)) return fail('Bad id', 400);
    const existing = await prisma.businessCategory.findUnique({ where: { id } });
    if (!existing) return fail('Not found', 404);
    await prisma.businessCategory.delete({ where: { id } });
    return ok({ deleted: existing.slug });
  } catch (e) {
    return handleError(e);
  }
});
