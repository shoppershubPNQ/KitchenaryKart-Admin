import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { fail, handleError, ok } from '@/lib/api';
import { createRazorpayOrder, verifyRazorpaySignature } from '@/lib/integrations/razorpay';
import { sendEmail } from '@/lib/integrations/resend';
import { buildOrderConfirmationEmail } from '@/lib/email-templates/order-confirmation';
import { buildAdminNewOrderEmail } from '@/lib/email-templates/admin-new-order';

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

    // Record coupon redemption — ONLY now that payment is confirmed, so
    // abandoned/failed orders never burn a coupon's usage count. Guarded
    // against double-verify (one redemption per order). Wrapped in
    // try/catch so a coupon-bookkeeping hiccup never fails an order that
    // the customer has already paid for.
    if (order.couponCode) {
      try {
        const coupon = await prisma.coupon.findUnique({
          where: { code: order.couponCode },
          select: { id: true },
        });
        if (coupon) {
          const already = await prisma.couponRedemption.findFirst({
            where: { couponId: coupon.id, orderId: order.id },
            select: { id: true },
          });
          if (!already) {
            await prisma.$transaction([
              prisma.couponRedemption.create({
                data: {
                  couponId: coupon.id,
                  orderId: order.id,
                  customerPhone: order.customerPhone,
                  customerEmail: order.customerEmail,
                  discountAmount: order.discountAmount,
                },
              }),
              prisma.coupon.update({
                where: { id: coupon.id },
                data: { usageCount: { increment: 1 } },
              }),
            ]);
          }
        }
      } catch (e) {
        console.error('[checkout] coupon redemption recording failed', e);
      }
    }

    // Send the order-confirmation email. MUST be awaited — Vercel serverless
    // functions terminate immediately after returning the response, which
    // cancels any in-flight `void`/fire-and-forget HTTP requests mid-flight
    // (the Resend SDK then errors out with "Unable to fetch data"). Adds
    // ~500ms to the response time, which is acceptable for a checkout call
    // that already takes a few seconds for Razorpay verification + DB write.
    // sendEmail() never throws — returns false on failure and logs it.
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
      await sendEmail({
        to: order.customerEmail,
        subject,
        html,
        text,
        category: 'order-confirmation',
      });
    }

    // Internal alert to the business so they can start fulfilment without
    // watching the dashboard. Awaited (Vercel cancels in-flight requests
    // after the response); sendEmail never throws. Recipient is
    // configurable via env, falling back to the seed admin / business box.
    // Notify BOTH real business inboxes — the Gmail and the Titan
    // support box. (admin@kitchenarykart.com is only the admin LOGIN, not
    // a real mailbox, so it must NOT be used here.) ADMIN_NOTIFY_EMAIL
    // (comma-separated) can override/extend this list.
    const adminRecipients = [
      ...new Set(
        [
          ...(process.env.ADMIN_NOTIFY_EMAIL || '').split(',').map((s) => s.trim()),
          'shoppershub.ind@gmail.com',
          'support@kitchenarykart.com',
        ].filter(Boolean),
      ),
    ];
    if (adminRecipients.length > 0) {
      const adminBase =
        process.env.ADMIN_BASE_URL || 'https://kitchenary-kart-admin-nujh.vercel.app';
      const adminMail = buildAdminNewOrderEmail({
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerEmail: order.customerEmail,
        totalAmount: Number(order.totalAmount || 0),
        discountAmount: Number(order.discountAmount || 0),
        couponCode: order.couponCode,
        paymentReference: order.paymentReference,
        items: order.items.map((it) => ({
          name: it.productName || '',
          sku: it.productSku || '',
          quantity: it.quantity,
          lineTotal: Number(it.lineTotal),
        })),
        adminOrderUrl: `${adminBase}/dashboard/orders/${order.id}`,
      });
      await sendEmail({
        to: adminRecipients,
        subject: adminMail.subject,
        html: adminMail.html,
        text: adminMail.text,
        category: 'admin-new-order',
      });
    }

    return ok({ order });
  } catch (e) {
    return handleError(e);
  }
}
