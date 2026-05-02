import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok, paging } from '@/lib/api';

export const GET = withAuth(async (req) => {
  try {
    const url = new URL(req.url);
    const { limit, offset } = paging(url);
    const status = url.searchParams.get('status') || undefined;

    const where: Prisma.InquiryWhereInput = {};
    if (status) where.status = status as any;

    const [inquiries, total] = await Promise.all([
      prisma.inquiry.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      prisma.inquiry.count({ where }),
    ]);
    return ok({ inquiries, total, limit, offset });
  } catch (e) {
    return handleError(e);
  }
});
