import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';

export const GET = withAuth(async () => {
  try {
    const rows = await prisma.setting.findMany({ orderBy: { key: 'asc' } });
    return ok({ settings: rows });
  } catch (e) {
    return handleError(e);
  }
});

const upsertSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  dataType: z.string().optional(),
});

export const PUT = withAuth(async (req) => {
  try {
    const body = upsertSchema.parse(await req.json());
    const setting = await prisma.setting.upsert({
      where: { key: body.key },
      update: { value: body.value, dataType: body.dataType },
      create: body,
    });
    return ok({ setting });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
