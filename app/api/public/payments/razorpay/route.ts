import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { fail, handleError, ok } from '@/lib/api';
import { createRazorpayOrder, verifyRazorpaySignature } from '@/lib/integrations/razorpay';
import { finalizePaidOrder } from '@/lib/order-payment';

const createSchema = z.object({
  orderId: z.number().int().positive(),
});

/** Create a Razorpay order for an existing KK order. Returns the order_id to hand to Checkout. */
export async function POST(req: NextRequest) {
  try {
    const body = createSchema.parse(await req.json());
    const order = await prisma.order.findUnique({ where: { id: body.orderId } });
    if (!order) return fail('Order not found', 404);

    const amountPaise = Math.round(Number(order.totalAmount || 0) * 100);
    const rz = await createRazorpayOrder(amountPaise, order.orderNumber);

    await prisma.order.update({
      where: { id: order.id },
      data: { razorpayOrderId: rz.id },
    });

    return ok({ razorpayOrderId: rz.id, amount: rz.amount, currency: rz.currency });
  } catch (e) {
    return handleError(e);
  }
}

const verifySchema = z.object({
  orderId: z.number().int().positive(),
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string(),
  razorpaySignature: z.string(),
});

/** Verification endpoint hit after Checkout success (client-side callback). */
export async function PUT(req: NextRequest) {
  try {
    const body = verifySchema.parse(await req.json());
    const okSig = verifyRazorpaySignature(body.razorpayOrderId, body.razorpayPaymentId, body.razorpaySignature);
    if (!okSig) return fail('Invalid signature', 400);

    // Bind the payment to THIS order. A valid signature only proves the
    // payment is real — NOT that it belongs to body.orderId. Without this,
    // an attacker could pay a cheap order and replay that signature against
    // an expensive one to mark it paid. Each order's razorpayOrderId was
    // created server-side with that order's exact amount, so requiring a
    // match guarantees the paid amount equals the order total.
    const existing = await prisma.order.findUnique({
      where: { id: body.orderId },
      select: { id: true, razorpayOrderId: true },
    });
    if (!existing) return fail('Order not found', 404);
    if (!existing.razorpayOrderId || existing.razorpayOrderId !== body.razorpayOrderId) {
      return fail('Payment does not match this order', 400);
    }

    // Mark paid + run all side effects (idempotent, shared with the webhook
    // and reconcile paths so behaviour can't drift).
    const result = await finalizePaidOrder(body.orderId, {
      razorpayPaymentId: body.razorpayPaymentId,
      razorpaySignature: body.razorpaySignature,
      source: 'checkout',
    });
    if (!result) return fail('Order not found', 404);
    return ok({ order: result.order, alreadyProcessed: result.alreadyProcessed });
  } catch (e) {
    return handleError(e);
  }
}
