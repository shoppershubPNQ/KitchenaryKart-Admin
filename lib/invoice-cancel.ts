/**
 * Cancelled invoices — a PAID order cancelled BEFORE DISPATCH (owner 2026-11-16,
 * KKMWI4BSPD: "yeh directly cancel hai").
 *
 * The invoice number was allocated when the customer paid, but nothing was
 * supplied, so the invoice is CANCELLED (GSTR-1 Table 13), not a sale — no
 * credit note. The GST report keeps such an order out of the sales rows.
 *
 * The decision is taken ONCE, at the moment the order is cancelled, and stamped
 * on the order as `invoiceCancelledAt`. Nothing evaluated later (a refund
 * recorded after the cut-off, a courier event, a credit note issued later) can
 * move an invoice in or out of a month that may already have been filed. That
 * was the flaw in deciding it whenever the report runs (review 2026-11-16).
 *
 * Rule: the order is cancelled WITHIN ITS INVOICE'S OWN MONTH (before the month
 * ends — nobody files GSTR-1 before then), it has an invoice and is paid, and
 * there is no sign anything left: no shipped / delivered stamp, no AWB typed, no
 * free replacement, no credit note, and no courier booking open, moved, or
 * cancelled too recently to be sure. Anything else stays a sale and is settled
 * by a CREDIT NOTE.
 */
import { prisma } from './db';

/** End of the invoice's report month: the report places an order in a month by
 *  UTC bounds (lib/invoice-serial.ts getMonthBounds), so the same bound is used. */
export function invoiceMonthEnd(invoiceCreatedAt: Date): Date {
  return new Date(Date.UTC(invoiceCreatedAt.getUTCFullYear(), invoiceCreatedAt.getUTCMonth() + 1, 1));
}

/** Is this order's invoice reported as a CANCELLED invoice (not a sale)? */
export function isCancelledInvoice(o: { invoiceCancelledAt: Date | null; createdAt: Date }): boolean {
  return !!o.invoiceCancelledAt && o.invoiceCancelledAt.getTime() < invoiceMonthEnd(o.createdAt).getTime();
}

const COURIER_MOVED = new Set(['in_transit', 'out_for_delivery', 'delivered', 'rto']);
const SHIPMENT_CLOSED = new Set(['draft', 'failed', 'cancelled']);
/** A cancelled courier booking can still turn out to have moved (Shiprocket is
 *  polled for 5 days after a cancel — lib/shipments.ts CANCEL_WATCH_MS). */
const CANCEL_WATCH_MS = 5 * 24 * 60 * 60_000;

/**
 * Called when an order moves INTO cancelled: returns the stamp for
 * `invoiceCancelledAt` (= `now`) if its invoice can be cancelled outright, or
 * null if it must stay a sale (and be reversed by a credit note).
 */
export async function invoiceCancelStamp(orderId: number, now: Date = new Date()): Promise<Date | null> {
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      invoiceSerial: true, paymentStatus: true, createdAt: true, shippedAt: true, deliveredAt: true, trackingNumber: true,
      creditNotes: { select: { id: true } },
      replacements: { select: { id: true } },
      shipments: { select: { status: true, cancelledAt: true, lastError: true, events: { select: { mappedStatus: true } } } },
    },
  });
  if (!o || o.invoiceSerial == null) return null;
  if (o.paymentStatus !== 'completed' && o.paymentStatus !== 'refunded') return null;
  if (now.getTime() >= invoiceMonthEnd(o.createdAt).getTime()) return null; // month over — credit note
  if (o.shippedAt || o.deliveredAt || o.trackingNumber?.trim()) return null;
  if (o.creditNotes.length || o.replacements.length) return null;
  for (const s of o.shipments) {
    if (!SHIPMENT_CLOSED.has(s.status)) return null;
    if (s.events.some((e) => e.mappedStatus && COURIER_MOVED.has(e.mappedStatus))) return null;
    if (s.lastError?.startsWith('CANCEL DID NOT TAKE')) return null;
    if (s.status === 'cancelled' && (!s.cancelledAt || now.getTime() - s.cancelledAt.getTime() < CANCEL_WATCH_MS)) return null;
  }
  return now;
}
