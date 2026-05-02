import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { fail, handleError, ok } from '@/lib/api';
import { createRazorpayOrder, verifyRazorpaySignature } from '@/lib/integrations/razorpay';

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

/** Webhook-style verification endpoint hit after Checkout success. */
export async function PUT(req: NextRequest) {
  try {
    const body = verifySchema.parse(await req.json());
    const okSig = verifyRazorpaySignature(body.razorpayOrderId, body.razorpayPaymentId, body.razorpaySignature);
    if (!okSig) return fail('Invalid signature', 400);

    const order = await prisma.order.update({
      where: { id: body.orderId },
      data: {
        paymentStatus: 'completed',
        paymentMethod: 'razorpay',
        paymentReference: body.razorpayPaymentId,
        payments: {
          create: {
            amount: 0, // populated from Razorpay webhook in production
            paymentMethod: 'razorpay',
            status: 'completed',
            razorpayPaymentId: body.razorpayPaymentId,
            razorpaySignature: body.razorpaySignature,
          },
        },
      },
    });

    return ok({ order });
  } catch (e) {
    return handleError(e);
  }
}
