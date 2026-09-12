/**
 * Hourly cron: reconcile pending orders against Razorpay, then cancel the ones
 * the customer never paid for.
 *
 * Two jobs, in this order — the order matters:
 *   1. RECOVER — if Razorpay says a payment was actually `captured`, finalize
 *      the order (mark paid + invoice + emails). The webhook has been
 *      unreliable, so a genuinely paid order can sit as "pending" in our DB.
 *   2. CANCEL — only orders Razorpay confirms have NO captured payment AND are
 *      older than MIN_AGE_HOURS get cancelled. This is why we never cancel a
 *      paid order: we ask Razorpay first, every time — about the checkout
 *      order AND any payment link. Orders with a payment link are never
 *      auto-cancelled at all; the shop raised the link and decides.
 *
 * Stock is untouched — stock is only decremented on the "delivered"
 * transition, so a pending order never reserved any.
 *
 * Security: Vercel signs cron requests with CRON_SECRET (same pattern as the
 * storefront keepalive cron).
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { checkOrderPayment, finalizePaidOrder } from '@/lib/order-payment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Give the customer a full day to complete payment before we cancel. */
const MIN_AGE_HOURS = 24;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (expected && authHeader !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const recovered: string[] = [];
  const cancelled: string[] = [];
  const keptYoung: string[] = [];
  const keptPaymentLink: string[] = [];
  const doublePaid: string[] = [];
  const errors: Array<{ orderNumber: string; error: string }> = [];

  try {
    const pending = await prisma.order.findMany({
      where: {
        paymentStatus: 'pending',
        orderStatus: { not: 'cancelled' },
        OR: [{ razorpayOrderId: { not: null } }, { paymentLinkId: { not: null } }],
      },
      select: { id: true, orderNumber: true, razorpayOrderId: true, paymentLinkId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    for (const o of pending) {
      const ageHours = (now - new Date(o.createdAt).getTime()) / 3600000;
      try {
        // Checks the checkout order AND any payment link — a link payment
        // must never be mistaken for "unpaid" just because checkout was not.
        const { captured, doublePaid: both } = await checkOrderPayment(o);

        if (captured) {
          // Really paid — recover it instead of cancelling.
          await finalizePaidOrder(o.id, {
            razorpayPaymentId: captured.paymentId,
            amountPaise: captured.amountPaise,
            source: captured.source,
          });
          recovered.push(o.orderNumber);
          if (both) {
            doublePaid.push(o.orderNumber);
            console.warn('[cancel-stale-orders] paid twice (checkout + payment link), refund one:', o.orderNumber);
          }
        } else if (o.paymentLinkId) {
          // The shop is collecting this one by hand. Link expiry (7 days) and
          // cancelling are the shop's call, not this cron's.
          keptPaymentLink.push(o.orderNumber);
        } else if (ageHours >= MIN_AGE_HOURS) {
          await prisma.order.update({ where: { id: o.id }, data: { orderStatus: 'cancelled' } });
          cancelled.push(o.orderNumber);
        } else {
          keptYoung.push(o.orderNumber);
        }
      } catch (e) {
        // Never cancel on an API error — an unreachable Razorpay must not look
        // like "unpaid". Skip and retry on the next run.
        errors.push({ orderNumber: o.orderNumber, error: e instanceof Error ? e.message : 'failed' });
      }
    }

    return NextResponse.json({
      ok: true,
      checked: pending.length,
      recoveredCount: recovered.length,
      cancelledCount: cancelled.length,
      recovered,
      cancelled,
      keptYoung,
      keptPaymentLink,
      doublePaid,
      errors,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'failed', recovered, cancelled, errors },
      { status: 500 },
    );
  }
}
