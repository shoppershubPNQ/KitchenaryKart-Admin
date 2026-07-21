/**
 * Featured Spotlight collection endpoint.
 *  - GET  /api/spotlight — list all spotlights, ordered by position then id
 *  - POST /api/spotlight — create one. `slug` + `productSku` are required.
 *
 * The spotlight is a rich single-product feature shown on the home page and,
 * in full, on /featured/<slug>. Live price/stock come from the product at
 * render time; the content blocks below are edited here.
 */
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok, fail } from '@/lib/api';
import { revalidateWeb } from '@/lib/revalidateWeb';
import { spotlightSchema } from '@/lib/spotlight-schema';

export const GET = withAuth(async () => {
  try {
    const spotlights = await prisma.spotlight.findMany({
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    return ok({ spotlights });
  } catch (e) {
    return handleError(e);
  }
});

export const POST = withAuth(
  async (req) => {
    try {
      const body = spotlightSchema.parse(await req.json());
      const dup = await prisma.spotlight.findUnique({ where: { slug: body.slug } });
      if (dup) return fail(`Slug "${body.slug}" is already used`, 409);
      const spotlight = await prisma.spotlight.create({ data: body });
      await revalidateWeb('spotlight');
      return ok({ spotlight }, { status: 201 });
    } catch (e) {
      return handleError(e);
    }
  },
  ['admin', 'sales', 'staff'],
);
