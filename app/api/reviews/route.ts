/**
 * Admin: GET /api/reviews — list reviews with optional status filter.
 *
 * Query params:
 *   status   "approved" | "unapproved" | "all" (default "all")
 *   sku      filter to a single product SKU
 *   limit    default 100, max 500
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get('status') || 'all';
    const sku = url.searchParams.get('sku')?.trim() || undefined;
    const limit = Math.min(
      500,
      Math.max(1, parseInt(url.searchParams.get('limit') || '100')),
    );

    const where: Record<string, unknown> = {};
    if (sku) where.productSku = sku;
    if (status === 'approved') where.isApproved = true;
    else if (status === 'unapproved') where.isApproved = false;

    const reviews = await prisma.review.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true } },
        product: { select: { name: true } },
      },
    });

    return ok({ reviews });
  } catch (e) {
    return handleError(e);
  }
});
