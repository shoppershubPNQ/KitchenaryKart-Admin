/**
 * Public endpoint: mark an unpaid order as cancelled when the buyer closes
 * the Razorpay popup without paying. Keeps the admin Orders list clean —
 * popup-abandoned orders show as "cancelled" instead of lingering as
 * "pending" and looking like real orders awaiting fulfilment.
 *
 * SAFETY: the updateMany WHERE clause only ever matches orders that are
 * STILL unpaid (paymentStatus = pending, orderStatus = pending) AND whose
 * razorpayOrderId matches the one issued for this checkout. This makes the
 * operation atomic — a paid/verified order can NEVER be cancelled, even if
 * this fires in a race with payment verification. It is best-effort: a
 * non-match simply cancels nothing and returns ok, never an error.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handleError, ok } from '@/lib/api';

const schema = z.object({
  orderId: z.number().int().positive(),
  razorpayOrderId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const res = await prisma.order.updateMany({
      where: {
        id: body.orderId,
        razorpayOrderId: body.razorpayOrderId,
        paymentStatus: 'pending',
        orderStatus: 'pending',
      },
      data: { orderStatus: 'cancelled' },
    });
    return ok({ cancelled: res.count > 0 });
  } catch (e) {
    return handleError(e);
  }
}
