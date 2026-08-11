/**
 * Payment link for an order the shop raised on a customer's behalf.
 *
 * POST   creates a hosted Razorpay link for the order's outstanding amount and
 *        stores it. Idempotent: if a live link already exists it is returned
 *        rather than a second one being raised against the same order.
 * GET    re-checks the link with Razorpay and, if it has been paid, finalizes
 *        the order through the SAME path a website payment uses — invoice
 *        serial, confirmation email, team alert.
 *
 * The link is never auto-sent. Notifying a customer is the shop's decision, not
 * a side effect of pressing "create"; the admin gets the URL and shares it.
 */
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok, fail } from '@/lib/api';
import {
  createRazorpayPaymentLink,
  fetchRazorpayPaymentLink,
} from '@/lib/integrations/razorpay';
import { finalizePaidOrder } from '@/lib/order-payment';

export const POST = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    if (!Number.isFinite(id)) return fail('Bad id', 400);

    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true, orderNumber: true, totalAmount: true, paymentStatus: true,
        orderStatus: true, customerName: true, customerEmail: true, customerPhone: true,
        paymentLinkId: true, paymentLinkUrl: true,
      },
    });
    if (!order) return fail('Order not found', 404);
    if (order.paymentStatus === 'completed') return fail('This order is already paid', 400);
    if (order.orderStatus === 'cancelled') return fail('This order is cancelled', 400);

    // Reuse an existing link unless Razorpay says it is dead — raising a second
    // link for the same order invites the customer paying twice.
    if (order.paymentLinkId && order.paymentLinkUrl) {
      try {
        const live = await fetchRazorpayPaymentLink(order.paymentLinkId);
        if (live.status === 'created' || live.status === 'partially_paid') {
          return ok({ url: order.paymentLinkUrl, id: order.paymentLinkId, reused: true });
        }
      } catch {
        // Unreachable Razorpay — fall through and make a fresh link rather than
        // leaving the admin stuck.
      }
    }

    const amountPaise = Math.round(Number(order.totalAmount) * 100);
    if (amountPaise <= 0) return fail('Order total is zero — nothing to collect', 400);

    const link = await createRazorpayPaymentLink({
      amountPaise,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      description: `KitchenaryKart order ${order.orderNumber}`,
      // 7 days to pay, then the link dies rather than lingering indefinitely.
      expireBy: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
    });

    await prisma.order.update({
      where: { id },
      data: { paymentLinkId: link.id, paymentLinkUrl: link.short_url },
    });

    return ok({ url: link.short_url, id: link.id, reused: false });
  } catch (e) {
    return handleError(e);
  }
});

export const GET = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    if (!Number.isFinite(id)) return fail('Bad id', 400);

    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, orderNumber: true, paymentLinkId: true, paymentLinkUrl: true, paymentStatus: true },
    });
    if (!order) return fail('Order not found', 404);
    if (!order.paymentLinkId) return ok({ status: 'none' });
    if (order.paymentStatus === 'completed') return ok({ status: 'paid', url: order.paymentLinkUrl });

    const live = await fetchRazorpayPaymentLink(order.paymentLinkId);
    const captured = live.payments?.find((p) => p.status === 'captured');

    if (live.status === 'paid' && captured) {
      // Same finalize path as a website payment, so the invoice serial and the
      // confirmation email happen exactly once and exactly as they normally do.
      await finalizePaidOrder(order.id, {
        razorpayPaymentId: captured.payment_id,
        amountPaise: captured.amount ?? null,
        source: 'payment-link',
      });
      return ok({ status: 'paid', url: order.paymentLinkUrl, paymentId: captured.payment_id });
    }
    return ok({ status: live.status, url: order.paymentLinkUrl });
  } catch (e) {
    return handleError(e);
  }
});
