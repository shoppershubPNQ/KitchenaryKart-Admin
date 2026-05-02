/**
 * Banners collection endpoint.
 *  - GET  /api/banners?placement=hero|secondary — filter by placement (defaults to all)
 *  - POST /api/banners                          — create a banner; placement defaults to "hero"
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { revalidateWeb } from '@/lib/revalidateWeb';

const PLACEMENTS = ['hero', 'secondary'] as const;

const createSchema = z.object({
  placement: z.enum(PLACEMENTS).optional(),
  position: z.number().int().optional(),
  isActive: z.boolean().optional(),
  imageUrl: z.string().min(1),
  alt: z.string().nullable().optional(),
  eyebrow: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  subtitle: z.string().nullable().optional(),
  ctaText: z.string().nullable().optional(),
  ctaHref: z.string().nullable().optional(),
  productSku: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
});

export const GET = withAuth(async (req) => {
  try {
    const url = new URL(req.url);
    const placement = url.searchParams.get('placement') || undefined;
    const where = placement ? { placement } : {};
    const banners = await prisma.banner.findMany({
      where,
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    return ok({ banners });
  } catch (e) {
    return handleError(e);
  }
});

export const POST = withAuth(async (req) => {
  try {
    const body = createSchema.parse(await req.json());
    const banner = await prisma.banner.create({
      data: { ...body, placement: body.placement ?? 'hero' },
    });
    await revalidateWeb('banners');
    return ok({ banner }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);
