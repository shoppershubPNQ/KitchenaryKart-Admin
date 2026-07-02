import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';
import { fetchRazorpayOrderPayments } from '@/lib/integrations/razorpay';
import { finalizePaidOrder } from '@/lib/order-payment';

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
    const pending = await prisma.order.findMany({
      where: { paymentStatus: 'pending', razorpayOrderId: { not: null } },
      select: { id: true, orderNumber: true, razorpayOrderId: true },
      orderBy: { id: 'asc' },
    });

    const reconciled: Array<{ orderNumber: string; paymentId: string }> = [];
    const stillPending: string[] = [];
    const errors: Array<{ orderNumber: string; error: string }> = [];

    for (const o of pending) {
      try {
        const payments = await fetchRazorpayOrderPayments(o.razorpayOrderId!);
        const captured = payments.find((p) => p.status === 'captured');
        if (captured) {
          await finalizePaidOrder(o.id, {
            razorpayPaymentId: captured.id,
            amountPaise: captured.amount ?? null,
            source: 'reconcile',
          });
          reconciled.push({ orderNumber: o.orderNumber, paymentId: captured.id });
        } else {
          stillPending.push(o.orderNumber);
        }
      } catch (e) {
        errors.push({ orderNumber: o.orderNumber, error: e instanceof Error ? e.message : 'failed' });
      }
    }

    return ok({ checked: pending.length, reconciledCount: reconciled.length, reconciled, stillPending, errors });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
