/**
 * Single variant — update / delete by variant id.
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';

const updateSchema = z.object({
  variantType: z.string().min(1).optional(),
  variantValue: z.string().min(1).optional(),
  skuSuffix: z.string().nullable().optional(),
  priceModifier: z.number().optional(),
  stock: z.number().int().nonnegative().optional(),
});

export const PATCH = withAuth(async (req, { params }) => {
  try {
    const id = parseInt(params.id);
    const body = updateSchema.parse(await req.json());
    const variant = await prisma.productVariant.update({
      where: { id },
      data: body,
    });
    return ok({ variant });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);

export const DELETE = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    await prisma.productVariant.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);
