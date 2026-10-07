import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/integrations/resend';
import { buildOrderConfirmationEmail } from '@/lib/email-templates/order-confirmation';
import { buildAdminNewOrderEmail } from '@/lib/email-templates/admin-new-order';
import { ensureInvoiceNumber } from '@/lib/invoice-serial';
import { adminBaseUrl, adminRecipients } from '@/lib/admin-notify';
import { fetchRazorpayOrderPayments, fetchRazorpayPaymentLink } from '@/lib/integrations/razorpay';

const IST = 'Asia/Kolkata';
/** Calendar day in India, "YYYY-MM-DD" — compares as a string. */
const istDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: IST });
/** "7 Oct 2026, 10:44 am IST" for audit notes. */
const istStamp = (d: Date) =>
  `${d.toLocaleString('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })} IST`;

/** How the team email labels an offline payment's reference (methods from MarkPaidOffline). */
const REF_LABEL: Record<string, string> = {
  bank_transfer: 'Bank transfer ref',
  upi_direct: 'UPI ref',
  cash: 'Cash receipt',
  cheque: 'Cheque no.',
};

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
    /** Required for every Razorpay source; unused when `offline` is set. */
    razorpayPaymentId?: string;
    razorpaySignature?: string | null;
    /** Captured amount in paise (from Razorpay). Null for the legacy checkout
     * path, which didn't send it — keeps the payment row at 0 as before. */
    amountPaise?: number | null;
    source: 'checkout' | 'webhook' | 'reconcile' | 'payment-link' | 'offline';
    /**
     * Money received OUTSIDE Razorpay — bank transfer, UPI straight to our
     * account, cash, cheque — recorded by an admin. Goes through this same
     * function on purpose, so the invoice serial, coupon redemption and emails
     * cannot be skipped the way flipping the Payment status dropdown skips them.
     */
    offline?: { method: string; reference: string | null; note: string };
    /** Customer confirmation + team alert. Default true. */
    sendEmails?: boolean;
  }
): Promise<{ order: { id: number; paymentStatus: string }; alreadyProcessed: boolean } | null> {
  const existing = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, paymentStatus: true, internalNotes: true, createdAt: true },
  });
  if (!existing) return null;
  if (existing.paymentStatus === 'completed') {
    return { order: existing, alreadyProcessed: true };
  }

  // An order counts on the day it is PAID (owner, 7 Oct 2026). One paid on a
  // later day than it was placed — a bank transfer or payment link that came
  // in days after, an auto-cancelled order paid late — takes the payment time
  // as its order date: it shows as that day's order, its revenue lands in that
  // day/month, and its GST invoice (dated from the order date) follows the
  // invoices issued before it. Same-day payments keep their own date.
  const paidAt = new Date();
  const notes: string[] = [];
  // Who recorded an offline payment, how, and with what reference — the
  // only audit trail there is, since no gateway saw this money.
  if (opts.offline) notes.push(opts.offline.note);
  const redate = istDay(existing.createdAt) < istDay(paidAt);
  if (redate) {
    notes.push(
      `[${istStamp(paidAt)}] Order date moved from ${istStamp(existing.createdAt)} (placed) to ${istStamp(paidAt)} (paid) — an order counts on the day it is paid.`,
    );
  }

  const order = await prisma.order.update({
    where: { id: orderId },
    data: {
      paymentStatus: 'completed',
      // Paid orders move straight into the fulfilment queue.
      orderStatus: 'processing',
      paymentMethod: opts.offline ? opts.offline.method : 'razorpay',
      paymentReference: opts.offline ? opts.offline.reference : opts.razorpayPaymentId ?? null,
      ...(redate ? { createdAt: paidAt } : {}),
      ...(notes.length
        ? { internalNotes: [existing.internalNotes, ...notes].filter(Boolean).join('\n') }
        : {}),
      payments: {
        create: {
          amount: opts.amountPaise != null ? opts.amountPaise / 100 : 0,
          paymentMethod: opts.offline ? opts.offline.method : 'razorpay',
          paymentReference: opts.offline ? opts.offline.reference : null,
          status: 'completed',
          razorpayPaymentId: opts.offline ? null : opts.razorpayPaymentId ?? null,
          razorpaySignature: opts.offline ? null : opts.razorpaySignature ?? null,
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
  if (opts.sendEmails !== false && order.customerEmail) {
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
  const recipients = opts.sendEmails === false ? [] : adminRecipients();
  if (recipients.length > 0) {
    const adminBase = adminBaseUrl();
    const adminMail = buildAdminNewOrderEmail({
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerEmail: order.customerEmail,
      totalAmount: Number(order.totalAmount || 0),
      discountAmount: Number(order.discountAmount || 0),
      couponCode: order.couponCode,
      paymentReference: order.paymentReference,
      paymentLabel: opts.offline ? REF_LABEL[opts.offline.method] ?? 'Payment ref' : 'Razorpay',
      items: order.items.map((it) => ({
        name: it.productName || '',
        sku: it.productSku || '',
        quantity: it.quantity,
        lineTotal: Number(it.lineTotal),
      })),
      adminOrderUrl: `${adminBase}/dashboard/orders/${order.id}`,
    });
    await sendEmail({
      to: recipients,
      subject: adminMail.subject,
      html: adminMail.html,
      text: adminMail.text,
      category: 'admin-new-order',
    });
  }

  return { order: { id: order.id, paymentStatus: order.paymentStatus }, alreadyProcessed: false };
}
