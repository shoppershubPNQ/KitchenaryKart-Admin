/**
 * POST /api/orders/[id]/contacted   — mark abandoned cart contacted
 * DELETE /api/orders/[id]/contacted — undo (clear contactedAt)
 *
 * Lightweight endpoints separate from the main PATCH /api/orders/[id]
 * so the abandoned-carts dashboard can fire-and-forget after the
 * admin clicks the WhatsApp button. Setting contactedAt removes the
 * order from the default abandoned-carts queue.
 *
 * Idempotent on the POST side — re-posting just refreshes contactedAt.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';

export const POST = withAuth(
  async (_req: NextRequest, ctx: { params: { id: string } }) => {
    try {
      const id = parseInt(ctx.params.id, 10);
      if (!Number.isFinite(id)) return fail('Invalid order id', 400);

      const order = await prisma.order.update({
        where: { id },
        data: { contactedAt: new Date() },
        select: { id: true, contactedAt: true },
      });
      return ok({ order });
    } catch (e) {
      return handleError(e);
    }
  },
);

export const DELETE = withAuth(
  async (_req: NextRequest, ctx: { params: { id: string } }) => {
    try {
      const id = parseInt(ctx.params.id, 10);
      if (!Number.isFinite(id)) return fail('Invalid order id', 400);

      const order = await prisma.order.update({
        where: { id },
        data: { contactedAt: null },
        select: { id: true, contactedAt: true },
      });
      return ok({ order });
    } catch (e) {
      return handleError(e);
    }
  },
);
