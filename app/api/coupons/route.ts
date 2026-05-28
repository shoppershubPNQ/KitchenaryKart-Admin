/**
 * Admin coupon management.
 *   GET  /api/coupons        — list all coupons (newest first)
 *   POST /api/coupons        — create a coupon
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';

export const GET = withAuth(async () => {
  try {
    const coupons = await prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { redemptions: true } } },
    });
    return ok({ coupons });
  } catch (e) {
    return handleError(e);
  }
});

const createSchema = z.object({
  code: z.string().min(2).max(40),
  description: z.string().max(200).optional().nullable(),
  discountType: z.enum(['percent', 'fixed']),
  discountValue: z.number().positive(),
  minOrderValue: z.number().nonnegative().optional().nullable(),
  maxDiscountAmount: z.number().positive().optional().nullable(),
  usageLimit: z.number().int().positive().optional().nullable(),
  perCustomerLimit: z.number().int().positive().optional().nullable(),
  startsAt: z.string().datetime().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = createSchema.parse(await req.json());
    const code = body.code.trim().toUpperCase();

    // Percentage can't exceed 100.
    if (body.discountType === 'percent' && body.discountValue > 100) {
      return fail('Percentage discount cannot exceed 100%.', 400);
    }

    const coupon = await prisma.coupon.create({
      data: {
        code,
        description: body.description?.trim() || null,
        discountType: body.discountType,
        discountValue: new Prisma.Decimal(body.discountValue),
        minOrderValue:
          body.minOrderValue != null ? new Prisma.Decimal(body.minOrderValue) : null,
        maxDiscountAmount:
          body.discountType === 'percent' && body.maxDiscountAmount != null
            ? new Prisma.Decimal(body.maxDiscountAmount)
            : null,
        usageLimit: body.usageLimit ?? null,
        perCustomerLimit: body.perCustomerLimit ?? null,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        isActive: body.isActive,
      },
    });
    return ok({ coupon });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return fail('A coupon with that code already exists.', 409);
    }
    return handleError(e);
  }
}, ['admin', 'sales']);
