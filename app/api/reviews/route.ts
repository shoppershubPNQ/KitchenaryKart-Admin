/**
 * Admin: GET /api/reviews — list reviews with optional status filter.
 *
 * Query params:
 *   status   "approved" | "unapproved" | "all" (default "all")
 *   sku      filter to a single product SKU
 *   limit    default 100, max 500
 *
 * Admin: POST /api/reviews — seed a fake / demo review.
 *
 * Bypasses the storefront's verified-buyer check (which still applies
 * to customer-side writes). customerId is left null so multiple
 * admin-authored reviews can exist per SKU without colliding with the
 * (sku, customerId) unique constraint.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { revalidateWeb } from '@/lib/revalidateWeb';

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

const postSchema = z.object({
  productSku: z.string().min(1),
  customerName: z.string().min(1).max(80),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(80).optional().nullable(),
  body: z.string().min(10).max(2000),
  isApproved: z.boolean().optional().default(true),
  /** Optional ISO date — lets admins backdate seeded reviews so they
   *  don't all bunch up at the same timestamp. */
  createdAt: z.string().datetime().optional(),
});

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = postSchema.parse(await req.json());
    const productSku = body.productSku.trim();

    // Look up productId if the SKU exists in the catalog (best effort).
    const product = await prisma.product.findUnique({
      where: { sku: productSku },
      select: { id: true },
    });
    if (!product) {
      return fail(`No product found with SKU ${productSku}`, 400);
    }

    const review = await prisma.review.create({
      data: {
        productSku,
        productId: product.id,
        customerId: null, // admin-authored — see schema comment
        customerName: body.customerName.trim(),
        rating: body.rating,
        title: body.title?.trim() || null,
        body: body.body.trim(),
        isApproved: body.isApproved,
        ...(body.createdAt ? { createdAt: new Date(body.createdAt) } : {}),
      },
    });

    revalidateWeb('reviews');
    return ok({ review });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales']);
