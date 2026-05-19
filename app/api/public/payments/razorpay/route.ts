import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { fail, handleError, ok } from '@/lib/api';
import { createRazorpayOrder, verifyRazorpaySignature } from '@/lib/integrations/razorpay';
import { sendEmail } from '@/lib/integrations/resend';
import { buildOrderConfirmationEmail } from '@/lib/email-templates/order-confirmation';

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
      include: { items: true },
    });

    // Fire the order-confirmation email. Awaited so any thrown error is
    // caught by handleError, but the email helper is non-throwing and
    // returns false on failure — email delivery never blocks the API
    // returning success to the storefront.
    if (order.customerEmail) {
      const { subject, html, text } = buildOrderConfirmationEmail({
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        totalAmount: Number(order.totalAmount || 0),
        subtotal: Number(order.subtotal || 0),
        taxAmount: Number(order.taxAmount || 0),
        shippingCost: Number(order.shippingCost || 0),
        shippingAddress: order.shippingAddress,
        paymentReference: order.paymentReference,
        items: order.items.map((it) => ({
          name: it.productName || '',
          sku: it.productSku || '',
          quantity: it.quantity,
          unitPrice: Number(it.unitPrice),
          lineTotal: Number(it.lineTotal),
        })),
      });
      // Fire and forget — log internally if it fails but don't fail the response.
      void sendEmail({
        to: order.customerEmail,
        subject,
        html,
        text,
        category: 'order-confirmation',
      });
    }

    return ok({ order });
  } catch (e) {
    return handleError(e);
  }
}
