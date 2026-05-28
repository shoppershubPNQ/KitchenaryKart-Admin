/**
 * Admin single-coupon ops.
 *   GET    /api/coupons/[id]  — fetch one (with redemption count)
 *   PATCH  /api/coupons/[id]  — update fields (incl. isActive toggle)
 *   DELETE /api/coupons/[id]  — delete (cascades redemptions)
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';

function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isFinite(id) ? id : null;
}

export const GET = withAuth(
  async (_req: NextRequest, ctx: { params: { id: string } }) => {
    try {
      const id = parseId(ctx.params.id);
      if (id == null) return fail('Invalid coupon id', 400);
      const coupon = await prisma.coupon.findUnique({
        where: { id },
        include: { _count: { select: { redemptions: true } } },
      });
      if (!coupon) return fail('Coupon not found', 404);
      return ok({ coupon });
    } catch (e) {
      return handleError(e);
    }
  },
);

const patchSchema = z.object({
  description: z.string().max(200).optional().nullable(),
  discountType: z.enum(['percent', 'fixed']).optional(),
  discountValue: z.number().positive().optional(),
  minOrderValue: z.number().nonnegative().optional().nullable(),
  maxDiscountAmount: z.number().positive().optional().nullable(),
  usageLimit: z.number().int().positive().optional().nullable(),
  perCustomerLimit: z.number().int().positive().optional().nullable(),
  startsAt: z.string().datetime().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const PATCH = withAuth(
  async (req: NextRequest, ctx: { params: { id: string } }) => {
    try {
      const id = parseId(ctx.params.id);
      if (id == null) return fail('Invalid coupon id', 400);
      const body = patchSchema.parse(await req.json());

      if (
        body.discountType === 'percent' &&
        body.discountValue != null &&
        body.discountValue > 100
      ) {
        return fail('Percentage discount cannot exceed 100%.', 400);
      }

      const data: Prisma.CouponUpdateInput = {};
      if (body.description !== undefined)
        data.description = body.description?.trim() || null;
      if (body.discountType !== undefined) data.discountType = body.discountType;
      if (body.discountValue !== undefined)
        data.discountValue = new Prisma.Decimal(body.discountValue);
      if (body.minOrderValue !== undefined)
        data.minOrderValue =
          body.minOrderValue != null ? new Prisma.Decimal(body.minOrderValue) : null;
      if (body.maxDiscountAmount !== undefined)
        data.maxDiscountAmount =
          body.maxDiscountAmount != null
            ? new Prisma.Decimal(body.maxDiscountAmount)
            : null;
      if (body.usageLimit !== undefined) data.usageLimit = body.usageLimit ?? null;
      if (body.perCustomerLimit !== undefined)
        data.perCustomerLimit = body.perCustomerLimit ?? null;
      if (body.startsAt !== undefined)
        data.startsAt = body.startsAt ? new Date(body.startsAt) : null;
      if (body.expiresAt !== undefined)
        data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
      if (body.isActive !== undefined) data.isActive = body.isActive;

      const coupon = await prisma.coupon.update({ where: { id }, data });
      return ok({ coupon });
    } catch (e) {
      return handleError(e);
    }
  },
  ['admin', 'sales'],
);

export const DELETE = withAuth(
  async (_req: NextRequest, ctx: { params: { id: string } }) => {
    try {
      const id = parseId(ctx.params.id);
      if (id == null) return fail('Invalid coupon id', 400);
      await prisma.coupon.delete({ where: { id } });
      return ok({ deleted: true });
    } catch (e) {
      return handleError(e);
    }
  },
  ['admin'],
);
