/**
 * Reads the unpaid website checkouts for a period and hands them to the pure
 * rules in lib/unpaid-checkouts.ts. Read-only: nothing is marked or sent.
 *
 * Razorpay is NOT asked here — that would be one API call per row on every
 * download. The 15-minute alert cron asks Razorpay for every open checkout and
 * the 24 h auto-cancel asks again before cancelling, so a payment the webhook
 * missed is caught there and the order leaves this list.
 */
import { prisma } from '@/lib/db';
import { reasonsForOrders } from '@/lib/checkout-feedback-lookup';
import { buildUnpaidCheckoutsWorkbook, selectUnpaidCheckouts, unpaidCheckoutsFilename, type UnpaidCheckoutResult } from '@/lib/unpaid-checkouts';

/** Periods the download offers, in days. */
export const UNPAID_PERIOD_DAYS = [1, 7, 30, 90] as const;

export function periodDays(raw: string | null | undefined): number {
  const d = parseInt(raw || '7', 10);
  return (UNPAID_PERIOD_DAYS as readonly number[]).includes(d) ? d : 7;
}

export function periodLabel(days: number): string {
  return days === 1 ? 'last 24 hours' : `last ${days} days`;
}

export async function loadUnpaidCheckouts(days: number, now = new Date()): Promise<UnpaidCheckoutResult> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const orders = await prisma.order.findMany({
    where: {
      razorpayOrderId: { not: null },
      replacementOfId: null,
      paymentStatus: { in: ['pending', 'failed'] },
      orderStatus: { in: ['pending', 'cancelled'] },
      createdAt: { gte: since },
    },
    select: {
      id: true,
      orderNumber: true,
      customerName: true,
      customerPhone: true,
      customerEmail: true,
      shippingAddress: true,
      totalAmount: true,
      orderStatus: true,
      paymentStatus: true,
      razorpayOrderId: true,
      replacementOfId: true,
      contactedAt: true,
      createdAt: true,
      items: { select: { productName: true, productSku: true, quantity: true }, orderBy: { id: 'asc' } },
    },
    orderBy: { createdAt: 'asc' },
  });
  // Paid orders from the same period, to drop buyers who came back and paid.
  const paid = await prisma.order.findMany({
    where: { paymentStatus: 'completed', replacementOfId: null, createdAt: { gte: since } },
    select: { customerPhone: true, customerEmail: true, createdAt: true },
  });
  const reasons = await reasonsForOrders(orders.map((o) => o.orderNumber));
  return selectUnpaidCheckouts(orders, paid, { now, reasons });
}

/** The Excel file for a period, ready to download or attach. */
export async function unpaidCheckoutsExcel(days: number, now = new Date()) {
  const result = await loadUnpaidCheckouts(days, now);
  const buffer = await buildUnpaidCheckoutsWorkbook(result, { now, periodLabel: periodLabel(days) });
  return { buffer, filename: unpaidCheckoutsFilename(now), result };
}
