/**
 * Single spotlight endpoint.
 *  - GET    /api/spotlight/[id] — fetch one
 *  - PATCH  /api/spotlight/[id] — partial update
 *  - DELETE /api/spotlight/[id] — remove (admin only; Cloudinary video left as-is)
 */
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok, fail } from '@/lib/api';
import { revalidateWeb } from '@/lib/revalidateWeb';
import { spotlightSchema } from '../route';

function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isFinite(id) ? id : null;
}

export const GET = withAuth(async (_req, ctx: { params: { id: string } }) => {
  try {
    const id = parseId(ctx.params.id);
    if (id === null) return fail('Bad id', 400);
    const spotlight = await prisma.spotlight.findUnique({ where: { id } });
    if (!spotlight) return fail('Not found', 404);
    return ok({ spotlight });
  } catch (e) {
    return handleError(e);
  }
});

export const PATCH = withAuth(
  async (req, ctx: { params: { id: string } }) => {
    try {
      const id = parseId(ctx.params.id);
      if (id === null) return fail('Bad id', 400);
      const body = spotlightSchema.partial().parse(await req.json());
      // Slug is unique — reject a clash with a *different* row.
      if (body.slug) {
        const dup = await prisma.spotlight.findUnique({ where: { slug: body.slug } });
        if (dup && dup.id !== id) return fail(`Slug "${body.slug}" is already used`, 409);
      }
      const spotlight = await prisma.spotlight.update({ where: { id }, data: body });
      await revalidateWeb('spotlight');
      return ok({ spotlight });
    } catch (e) {
      return handleError(e);
    }
  },
  ['admin', 'sales', 'staff'],
);

export const DELETE = withAuth(
  async (_req, ctx: { params: { id: string } }) => {
    try {
      const id = parseId(ctx.params.id);
      if (id === null) return fail('Bad id', 400);
      await prisma.spotlight.delete({ where: { id } });
      await revalidateWeb('spotlight');
      return ok({ deleted: true });
    } catch (e) {
      return handleError(e);
    }
  },
  ['admin'],
);
