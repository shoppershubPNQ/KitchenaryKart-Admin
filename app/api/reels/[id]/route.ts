/**
 * Single-reel endpoint.
 *  - GET    — fetch one
 *  - PATCH  — update (full or partial)
 *  - DELETE — remove (Cloudinary asset is left in place; orphans can be
 *             cleaned up later via Cloudinary console if storage matters)
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { revalidateWeb } from '@/lib/revalidateWeb';

const updateSchema = z.object({
  videoUrl: z.string().min(1).optional(),
  thumbnailUrl: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  instagramUrl: z.string().nullable().optional(),
  productSku: z.string().nullable().optional(),
  viewCount: z.number().int().min(0).optional(),
  position: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const GET = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    const reel = await prisma.reel.findUnique({ where: { id } });
    if (!reel) return fail('Not found', 404);
    return ok({ reel });
  } catch (e) {
    return handleError(e);
  }
});

export const PATCH = withAuth(async (req, { params }) => {
  try {
    const id = parseInt(params.id);
    const body = updateSchema.parse(await req.json());
    const reel = await prisma.reel.update({ where: { id }, data: body });
    await revalidateWeb('reels');
    return ok({ reel });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);

export const DELETE = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    await prisma.reel.delete({ where: { id } });
    await revalidateWeb('reels');
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
