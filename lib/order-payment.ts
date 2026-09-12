import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/integrations/resend';
import { buildOrderConfirmationEmail } from '@/lib/email-templates/order-confirmation';
import { buildAdminNewOrderEmail } from '@/lib/email-templates/admin-new-order';
import { ensureInvoiceNumber } from '@/lib/invoice-serial';
import { fetchRazorpayOrderPayments, fetchRazorpayPaymentLink } from '@/lib/integrations/razorpay';

export interface CapturedPayment {
  paymentId: string;
  amountPaise: number | null;
  source: 'reconcile' | 'payment-link';
}

/**
 * Ask Razorpay whether an order has been paid, through EITHER route money can
 * arrive: the website checkout (razorpayOrderId) or a hosted payment link the
 * shop raised (paymentLinkId — it makes its own Razorpay order, so there is no
 * shared id). An order can hold both: a customer abandons checkout, then the
 * shop sends a link. Checking only one would call a link-paid order "unpaid".
 *
 * `doublePaid` is true when BOTH took money — one of them needs a refund.
 * Throws on any Razorpay error: an unreachable API must never read as unpaid.
 */
export async function checkOrderPayment(o: {
  razorpayOrderId: string | null;
  paymentLinkId: string | null;
}): Promise<{ captured: CapturedPayment | null; doublePaid: boolean }> {
  let checkout: CapturedPayment | null = null;
  if (o.razorpayOrderId) {
    const payments = await fetchRazorpayOrderPayments(o.razorpayOrderId);
    const c = payments.find((p) => p.status === 'captured');
    if (c) checkout = { paymentId: c.id, amountPaise: c.amount ?? null, source: 'reconcile' };
  }

  let link: CapturedPayment | null = null;
  if (o.paymentLinkId) {
    const l = await fetchRazorpayPaymentLink(o.paymentLinkId);
    const p = l.payments?.find((x) => x.status === 'captured');
    if (l.status === 'paid' && p) link = { paymentId: p.payment_id, amountPaise: p.amount ?? null, source: 'payment-link' };
  }

  return { captured: checkout ?? link, doublePaid: Boolean(checkout && link) };
}

/**
 * Mark an order paid and run every side-effect exactly once, from ONE place.
 *
 * Three callers reach this: the client-side checkout verify (PUT), the
 * Razorpay webhook (`payment.captured`), and the admin reconcile endpoint.
 * Keeping the logic here means a payment confirmed by ANY path gets the same
 * treatment — invoice serial, coupon redemption, confirmation + admin emails —
 * and can't drift between callers.
 *
 * Idempotent: if the order is already `completed`, it acks and does nothing
 * (a replayed verify / duplicate webhook must not re-send emails or re-burn a
 * coupon). CALLERS are responsible for proving the payment belongs to this
 * order BEFORE calling — the checkout PUT via signature+order binding, the
 * webhook/reconcile via Razorpay's own key-authed data.
 */
export async function finalizePaidOrder(
  orderId: number,
  opts: {
    razorpayPaymentId: string;
    razorpaySignature?: string | null;
    /** Captured amount in paise (from Razorpay). Null for the legacy checkout
     * path, which didn't send it — keeps the payment row at 0 as before. */
    amountPaise?: number | null;
    source: 'checkout' | 'webhook' | 'reconcile' | 'payment-link';
  }
): Promise<{ order: { id: number; paymentStatus: string }; alreadyProcessed: boolean } | null> {
  const existing = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, paymentStatus: true },
  });
  if (!existing) return null;
  if (existing.paymentStatus === 'completed') {
    return { order: existing, alreadyProcessed: true };
  }

  const order = await prisma.order.update({
    where: { id: orderId },
    data: {
      paymentStatus: 'completed',
      // Paid orders move straight into the fulfilment queue.
      orderStatus: 'processing',
      paymentMethod: 'razorpay',
      paymentReference: opts.razorpayPaymentId,
      payments: {
        create: {
          amount: opts.amountPaise != null ? opts.amountPaise / 100 : 0,
          paymentMethod: 'razorpay',
          status: 'completed',
          razorpayPaymentId: opts.razorpayPaymentId,
          razorpaySignature: opts.razorpaySignature ?? null,
        },
      },
    },
    include: { items: true },
  });

  // Allocate the GST invoice serial NOW that payment is confirmed, so paid
  // orders get clean sequential numbers in payment order. Best-effort: a
  // serial hiccup must never fail an order the customer already paid for.
  try {
    await ensureInvoiceNumber(order.id);
  } catch (e) {
    console.error('[order-payment] invoice serial allocation failed', e);
  }

  // Record coupon redemption — ONLY now that payment is confirmed, guarded
  // against double-processing (one redemption per order).
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
      console.error('[order-payment] coupon redemption recording failed', e);
    }
  }

  // Order-confirmation email. Awaited — Vercel serverless cancels in-flight
  // fire-and-forget requests after the response returns. sendEmail never throws.
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
    await sendEmail({ to: order.customerEmail, subject, html, text, category: 'order-confirmation' });
  }

  // Internal new-order alert to the business inboxes. Awaited; never throws.
  // admin@kitchenarykart.com is only the admin LOGIN, not a real mailbox, so
  // it must NOT be used here.
  const adminRecipients = [
    ...new Set(
      [
        ...(process.env.ADMIN_NOTIFY_EMAIL || '').split(',').map((s) => s.trim()),
        'shoppershub.ind@gmail.com',
        'support@kitchenarykart.com',
      ].filter(Boolean)
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

  return { order: { id: order.id, paymentStatus: order.paymentStatus }, alreadyProcessed: false };
}
