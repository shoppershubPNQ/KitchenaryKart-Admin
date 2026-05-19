/**
 * Reels collection endpoint.
 *  - GET  /api/reels — list all reels, ordered by position then id
 *  - POST /api/reels — create a new reel. videoUrl is required (use the
 *                      /api/reels/upload route to obtain one first).
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';
import { revalidateWeb } from '@/lib/revalidateWeb';

const createSchema = z.object({
  videoUrl: z.string().min(1),
  thumbnailUrl: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  instagramUrl: z.string().nullable().optional(),
  productSku: z.string().nullable().optional(),
  viewCount: z.number().int().min(0).optional(),
  position: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const GET = withAuth(async () => {
  try {
    const reels = await prisma.reel.findMany({
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    return ok({ reels });
  } catch (e) {
    return handleError(e);
  }
});

export const POST = withAuth(async (req) => {
  try {
    const body = createSchema.parse(await req.json());
    const reel = await prisma.reel.create({ data: body });
    await revalidateWeb('reels');
    return ok({ reel }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);
