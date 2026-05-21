/**
 * Admin: moderate a single review.
 *
 * PATCH /api/reviews/[id] — body: { isApproved?: boolean }
 * DELETE /api/reviews/[id] — remove permanently
 *
 * Both bust the storefront's `reviews` cache via revalidateWeb so the
 * PDP reflects moderation immediately.
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { revalidateWeb } from '@/lib/revalidateWeb';

const patchSchema = z.object({
  isApproved: z.boolean().optional(),
});

export const PATCH = withAuth(async (req, { params }) => {
  try {
    const id = parseInt(params.id);
    if (!Number.isFinite(id)) return fail('Invalid id', 400);
    const body = patchSchema.parse(await req.json());
    const review = await prisma.review.update({ where: { id }, data: body });
    revalidateWeb('reviews');
    return ok({ review });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales']);

export const DELETE = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    if (!Number.isFinite(id)) return fail('Invalid id', 400);
    await prisma.review.delete({ where: { id } });
    revalidateWeb('reviews');
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
