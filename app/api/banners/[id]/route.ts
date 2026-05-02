/**
 * Single-banner endpoint.
 *  - GET    — fetch one
 *  - PATCH  — update (full or partial)
 *  - DELETE — remove
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { revalidateWeb } from '@/lib/revalidateWeb';

const updateSchema = z.object({
  placement: z.enum(['hero', 'secondary']).optional(),
  position: z.number().int().optional(),
  isActive: z.boolean().optional(),
  imageUrl: z.string().min(1).optional(),
  alt: z.string().nullable().optional(),
  eyebrow: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  subtitle: z.string().nullable().optional(),
  ctaText: z.string().nullable().optional(),
  ctaHref: z.string().nullable().optional(),
  productSku: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
});

export const GET = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    const banner = await prisma.banner.findUnique({ where: { id } });
    if (!banner) return fail('Not found', 404);
    return ok({ banner });
  } catch (e) {
    return handleError(e);
  }
});

export const PATCH = withAuth(async (req, { params }) => {
  try {
    const id = parseInt(params.id);
    const body = updateSchema.parse(await req.json());
    const banner = await prisma.banner.update({ where: { id }, data: body });
    await revalidateWeb('banners');
    return ok({ banner });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);

export const DELETE = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    await prisma.banner.delete({ where: { id } });
    await revalidateWeb('banners');
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
