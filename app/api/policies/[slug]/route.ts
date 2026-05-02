/**
 * Single-policy endpoint.
 *
 * GET    /api/policies/:slug
 * PATCH  /api/policies/:slug — update title / body / isActive / position
 * DELETE /api/policies/:slug — admin-only
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { revalidateWeb } from '@/lib/revalidateWeb';

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  isActive: z.boolean().optional(),
  position: z.number().int().optional(),
});

export const GET = withAuth(async (_req, { params }) => {
  try {
    const policy = await prisma.policy.findUnique({ where: { slug: params.slug } });
    if (!policy) return fail('Not found', 404);
    return ok({ policy });
  } catch (e) {
    return handleError(e);
  }
});

export const PATCH = withAuth(async (req, { params }) => {
  try {
    const body = updateSchema.parse(await req.json());
    const policy = await prisma.policy.update({
      where: { slug: params.slug },
      data: body,
    });
    await revalidateWeb('policies');
    return ok({ policy });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);

export const DELETE = withAuth(async (_req, { params }) => {
  try {
    await prisma.policy.delete({ where: { slug: params.slug } });
    await revalidateWeb('policies');
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
