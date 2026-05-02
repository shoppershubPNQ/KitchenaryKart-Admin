import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';

const patchSchema = z.object({
  status: z.enum(['new', 'contacted', 'quoted', 'converted', 'rejected']).optional(),
  quotedAmount: z.number().nonnegative().optional(),
});

export const GET = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    const inquiry = await prisma.inquiry.findUnique({ where: { id } });
    if (!inquiry) return fail('Not found', 404);
    return ok({ inquiry });
  } catch (e) {
    return handleError(e);
  }
});

export const PATCH = withAuth(async (req, { params }) => {
  try {
    const id = parseInt(params.id);
    const body = patchSchema.parse(await req.json());
    const inquiry = await prisma.inquiry.update({ where: { id }, data: body });
    return ok({ inquiry });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales']);
