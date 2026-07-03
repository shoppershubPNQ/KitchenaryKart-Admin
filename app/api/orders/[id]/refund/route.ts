import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { createRazorpayRefund } from '@/lib/integrations/razorpay';

const bodySchema = z.object({
  // Partial refund amount in rupees. Omit for a FULL refund of totalAmount.
  amount: z.number().positive().optional(),
  reason: z.string().max(500).optional(),
});

/**
 * Issue a Razorpay refund for an order (admin-only). Owner-triggered from the
 * order page — never automatic. Guards: the order must be paid via Razorpay,
 * must have a payment id, and must not already be fully refunded. A partial
 * amount can't exceed the order total. On success we call Razorpay, then set
 * paymentStatus=refunded (full) and record the refund on the order.
 */
export const POST = withAuth(async (req, { params }) => {
  try {
    const id = parseInt(params.id);
    const body = bodySchema.parse(await req.json().catch(() => ({})));

    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        orderNumber: true,
        totalAmount: true,
        paymentStatus: true,
        paymentMethod: true,
        paymentReference: true,
        internalNotes: true,
        payments: { select: { razorpayPaymentId: true, status: true }, orderBy: { id: 'desc' } },
      },
    });
    if (!order) return fail('Order not found', 404);

    // Only a completed (paid) order can be refunded, and not twice.
    if (order.paymentStatus === 'refunded') return fail('This order is already refunded', 400);
    if (order.paymentStatus !== 'completed') {
      return fail('Only a paid (completed) order can be refunded', 400);
    }

    // The Razorpay payment id — set as paymentReference at capture; fall back to
    // the most recent completed payment record.
    const paymentId =
      order.paymentReference ||
      order.payments.find((p) => p.status === 'completed' && p.razorpayPaymentId)?.razorpayPaymentId ||
      null;
    if (!paymentId) {
      return fail('No Razorpay payment id on this order — cannot refund via API. Refund manually in the Razorpay dashboard.', 400);
    }

    const total = Number(order.totalAmount || 0);
    if (total <= 0) return fail('Order has no amount to refund', 400);

    // Partial amount can't exceed the total. Omitted ⇒ full refund.
    const isPartial = body.amount != null && body.amount < total;
    if (body.amount != null && body.amount > total + 0.01) {
      return fail(`Refund amount ₹${body.amount} exceeds the order total ₹${total}`, 400);
    }
    const amountPaise = body.amount != null ? Math.round(body.amount * 100) : undefined;

    // Money movement — Razorpay is the source of truth. If this throws, we
    // record nothing (the catch returns the error to the admin).
    const refund = await createRazorpayRefund(paymentId, amountPaise, {
      orderNumber: order.orderNumber,
      ...(body.reason ? { reason: body.reason } : {}),
    });

    const refundedRupees = refund.amount / 100;
    const stamp = `Refund ${isPartial ? 'PARTIAL ' : ''}₹${refundedRupees} via Razorpay (${refund.id})${body.reason ? ` — ${body.reason}` : ''}`;
    const internalNotes = order.internalNotes ? `${order.internalNotes}\n${stamp}` : stamp;

    await prisma.order.update({
      where: { id: order.id },
      data: {
        // Full refund flips the order to refunded; a partial refund leaves it
        // completed (still partly paid) but records the refund below.
        ...(isPartial ? {} : { paymentStatus: 'refunded' }),
        internalNotes,
        payments: {
          create: {
            amount: refundedRupees,
            paymentMethod: 'razorpay-refund',
            status: 'refunded',
            razorpayPaymentId: refund.id,
          },
        },
      },
    });

    return ok({ refundId: refund.id, amount: refundedRupees, partial: isPartial, status: refund.status });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
