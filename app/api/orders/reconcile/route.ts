import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';
import { checkOrderPayment, finalizePaidOrder } from '@/lib/order-payment';

/**
 * Reconcile pending orders against Razorpay (admin-only, idempotent).
 *
 * For every order still `paymentStatus=pending` that HAS a razorpayOrderId,
 * ask Razorpay for that order's payments. If any is `captured`, finalize it
 * (mark paid + invoice serial + confirmation/admin emails). Orders whose
 * Razorpay payments are only `failed`/`created` are LEFT pending — so a
 * customer's abandoned or failed duplicate attempt is never marked paid.
 * Matching is by razorpayOrderId (not amount), so a duplicate order that
 * shares a total with a genuinely-paid one is not falsely reconciled.
 *
 * Safe to re-run any time; the webhook is the going-forward fix, this cleans
 * up orders that got stuck before the webhook was live.
 */
export const POST = withAuth(async () => {
  try {
    // Two ways an order can be awaiting money: the website checkout (which
    // holds a razorpayOrderId) or an admin-raised order paid through a hosted
    // payment link (which holds a paymentLinkId — the link makes its own
    // Razorpay order, so there is no shared id). Both are checked here, or a
    // link-paid order would sit pending forever.
    const pending = await prisma.order.findMany({
      where: {
        paymentStatus: 'pending',
        OR: [{ razorpayOrderId: { not: null } }, { paymentLinkId: { not: null } }],
      },
      select: { id: true, orderNumber: true, razorpayOrderId: true, paymentLinkId: true },
      orderBy: { id: 'asc' },
    });

    const reconciled: Array<{ orderNumber: string; paymentId: string }> = [];
    const stillPending: string[] = [];
    const doublePaid: string[] = [];
    const errors: Array<{ orderNumber: string; error: string }> = [];

    for (const o of pending) {
      try {
        // Both sources are checked for every order — an order can hold a
        // checkout id AND a link, and either one may be the one that was paid.
        const { captured, doublePaid: both } = await checkOrderPayment(o);
        if (captured) {
          await finalizePaidOrder(o.id, {
            razorpayPaymentId: captured.paymentId,
            amountPaise: captured.amountPaise,
            source: captured.source,
          });
          reconciled.push({ orderNumber: o.orderNumber, paymentId: captured.paymentId });
          if (both) doublePaid.push(o.orderNumber);
        } else {
          stillPending.push(o.orderNumber);
        }
      } catch (e) {
        errors.push({ orderNumber: o.orderNumber, error: e instanceof Error ? e.message : 'failed' });
      }
    }

    return ok({ checked: pending.length, reconciledCount: reconciled.length, reconciled, stillPending, doublePaid, errors });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
