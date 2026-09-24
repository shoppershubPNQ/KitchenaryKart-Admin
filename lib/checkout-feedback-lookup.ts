import { prisma } from '@/lib/db';

/**
 * What the buyer said on their way out, for a given unpaid order.
 *
 * The popup files its answer against the analytics SESSION, not an order —
 * it is shown to people who never got as far as creating one. The two are
 * joined through analytics_events, which carries both the session and the
 * order number on every checkout event.
 *
 * Returns null whenever the join cannot be made honestly: the visitor blocks
 * tracking, they closed the tab without answering, or they skipped. The alert
 * email then reads exactly as it did before — an absent answer must never be
 * dressed up as one.
 */

const LABELS: Record<string, string> = {
  price_high: 'Price is too high',
  need_details: 'I need more product details',
  want_to_talk: 'I want to talk to someone first',
  payment_missing: 'My preferred payment option is missing',
  checkout_problem: 'I had a problem at checkout',
  still_deciding: "I'm still deciding",
  other: 'Other',
};

export interface BuyerReason {
  reason: string;
  label: string;
  note: string | null;
  at: Date;
}

export async function reasonForOrder(orderNumber: string): Promise<BuyerReason | null> {
  if (!orderNumber) return null;

  const events = await prisma.analyticsEvent.findMany({
    where: { orderNumber, sessionId: { not: null } },
    select: { sessionId: true },
    distinct: ['sessionId'],
    take: 5,
  });
  const sessions = events.map((e) => e.sessionId).filter((s): s is string => !!s);
  if (sessions.length === 0) return null;

  // The last answer from that visit. A shopper is only asked once per
  // checkout, so in practice there is one.
  const fb = await prisma.checkoutFeedback.findFirst({
    where: { sessionId: { in: sessions } },
    orderBy: { createdAt: 'desc' },
    select: { reason: true, note: true, createdAt: true },
  });
  if (!fb) return null;

  return {
    reason: fb.reason,
    label: LABELS[fb.reason] ?? fb.reason,
    note: fb.note,
    at: fb.createdAt,
  };
}

/** The same lookup for a batch of orders, in two queries rather than 2N. */
export async function reasonsForOrders(
  orderNumbers: string[],
): Promise<Map<string, BuyerReason>> {
  const wanted = orderNumbers.filter(Boolean);
  const out = new Map<string, BuyerReason>();
  if (wanted.length === 0) return out;

  const events = await prisma.analyticsEvent.findMany({
    where: { orderNumber: { in: wanted }, sessionId: { not: null } },
    select: { orderNumber: true, sessionId: true },
  });
  if (events.length === 0) return out;

  const orderBySession = new Map<string, string>();
  for (const e of events) {
    if (e.sessionId && e.orderNumber && !orderBySession.has(e.sessionId)) {
      orderBySession.set(e.sessionId, e.orderNumber);
    }
  }

  const rows = await prisma.checkoutFeedback.findMany({
    where: { sessionId: { in: [...orderBySession.keys()] } },
    orderBy: { createdAt: 'desc' },
    select: { reason: true, note: true, createdAt: true, sessionId: true },
  });

  for (const r of rows) {
    const order = r.sessionId ? orderBySession.get(r.sessionId) : undefined;
    // findMany is newest-first, so the first row seen for an order wins.
    if (order && !out.has(order)) {
      out.set(order, {
        reason: r.reason,
        label: LABELS[r.reason] ?? r.reason,
        note: r.note,
        at: r.createdAt,
      });
    }
  }
  return out;
}
