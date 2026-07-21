/**
 * Featured Spotlight collection endpoint.
 *  - GET  /api/spotlight — list all spotlights, ordered by position then id
 *  - POST /api/spotlight — create one. `slug` + `productSku` are required.
 *
 * The spotlight is a rich single-product feature shown on the home page and,
 * in full, on /featured/<slug>. Live price/stock come from the product at
 * render time; the content blocks below are edited here.
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok, fail } from '@/lib/api';
import { revalidateWeb } from '@/lib/revalidateWeb';

/** Shared content-block shapes. All are optional + default to empty so a
 *  half-filled spotlight still saves. */
export const spotlightSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'Slug: lowercase letters, numbers and hyphens only'),
  productSku: z.string().min(1),
  eyebrow: z.string().nullable().optional(),
  headline: z.string().nullable().optional(),
  videoUrl: z.string().nullable().optional(),
  videoPoster: z.string().nullable().optional(),
  keyFeatures: z.array(z.string()).optional(),
  specifications: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  packagingIncludes: z.array(z.string()).optional(),
  idealFor: z.array(z.string()).optional(),
  whyBuy: z.array(z.object({ title: z.string(), text: z.string() })).optional(),
  comparison: z
    .object({ rows: z.array(z.object({ feature: z.string(), kk: z.string(), others: z.string() })) })
    .optional(),
  careDisposal: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  position: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

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
