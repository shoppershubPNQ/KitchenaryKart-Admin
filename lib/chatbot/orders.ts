/**
 * Order status lookup for the website chatbot (track_order).
 *
 * Same ownership rule as the storefront's guest /track lookup
 * (web/lib/orders.ts loadPublicOrder): the last 4 digits of the phone on the
 * order must match. Reduced output: the result NEVER includes the address,
 * customer name, phone, email, GSTIN, invoice number, other money fields,
 * payment refs or internal notes - only status, dates, courier/tracking,
 * item names and the order total.
 *
 * A missing order and a wrong last-4 return the IDENTICAL `{ match: false }`,
 * so the bot cannot be used to probe which order numbers exist.
 *
 * Guessing protection: 5 look-ups per chat, and - because a new chat costs
 * nothing - 6 attempts per order number per day and 10 per visitor network
 * per hour (chat_rate_limits keys 'trk:ord:<order>' / 'trk:ip:<hash>'). The
 * attempt is counted BEFORE the order is read, so a missing order and a real
 * one behave the same.
 */
import { prisma } from '../db';
import { formatInr, SITE_URL } from './catalog';
import { hitLimit, UNKNOWN_IP_BUCKET, type LimitResult } from './limits';
import { LIMITS } from './models';

export interface OrderLookupCtx {
  orderLookups: number;
  /** HMAC of the visitor network (lib/chatbot/limits.ts), null when unknown. */
  ipHash: string | null;
}

/** The counter used for the per-order / per-IP attempt limits (injectable for tests). */
export interface OrderLookupDeps {
  hitLimit(key: string, windowSec: number, limit: number): Promise<LimitResult>;
}

const MAX_LOOKUPS = LIMITS.maxOrderLookupsPerSession;
const IST = 'Asia/Kolkata';

const last4 = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').slice(-4);

/** "kk1a2b3c4d" -> ["KK1A2B3C4D", "KK-1A2B3C4D"]; "KK-ABC" -> ["KK-ABC", "KKABC"].
 *  Website orders are KK<base36>, manual orders KK-<base36>. Null when the
 *  text cannot be an order number. */
export function orderCandidates(orderNumber: string): string[] | null {
  const s = orderNumber.toUpperCase().replace(/[\s#]/g, '');
  if (!/^[A-Z0-9-]{4,30}$/.test(s)) return null;
  const out = [s, s.replace(/^KK-/, 'KK')];
  if (s.startsWith('KK') && !s.startsWith('KK-')) out.push(`KK-${s.slice(2)}`);
  return [...new Set(out)];
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' });
const fmtDateTime = (d: Date) =>
  `${fmtDate(d)}, ${d.toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true })}`;

/** Customer wording of web/components/OrderStatusTimeline.tsx. */
function statusLabel(o: { orderStatus: string; paymentStatus: string; shippedAt: Date | null; deliveredAt: Date | null }): string {
  if (o.orderStatus === 'cancelled') return 'Cancelled';
  if (o.orderStatus === 'returned') return 'Returned';
  if (o.orderStatus === 'delivered' || o.deliveredAt) return 'Delivered';
  if (o.orderStatus === 'shipped' || o.shippedAt) return 'Shipped';
  if (o.paymentStatus === 'completed') return 'Processing - payment received, being prepared for dispatch';
  return 'Order placed - payment not yet received';
}

const PAYMENT_LABELS: Record<string, string> = {
  pending: 'Payment pending',
  completed: 'Paid',
  failed: 'Payment failed',
  refunded: 'Refunded',
};

function httpsUrl(u: string | null): string | null {
  if (!u) return null;
  try {
    return new URL(u).protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

export type OrderLookupResult =
  | { ok: false; error: 'too_many_attempts' | 'invalid_last4'; detail: string; isError: true }
  | { ok: true; match: false }
  | {
      ok: true;
      match: true;
      order_number: string;
      placed_on: string;
      status: string;
      payment: string;
      shipped_on: string | null;
      delivered_on: string | null;
      courier: string | null;
      tracking_number: string | null;
      tracking_url: string | null;
      latest_update: { status: string; location: string | null; at: string } | null;
      total_display: string | null;
      items: Array<{ name: string; quantity: number }>;
      track_page: string;
    };

const TOO_MANY: OrderLookupResult = {
  ok: false,
  error: 'too_many_attempts',
  detail: 'Ask the customer to WhatsApp the team.',
  isError: true,
};

/** "KK-1A2B" and "KK1A2B" count as the same order. */
const orderKey = (candidates: string[]) => 'KK' + candidates[0].replace(/^KK-?/, '');

export async function lookupOrderForChat(
  orderNumber: string,
  phoneLast4: string,
  ctx: OrderLookupCtx,
  deps: OrderLookupDeps = { hitLimit },
): Promise<OrderLookupResult> {
  if (ctx.orderLookups >= MAX_LOOKUPS) return TOO_MANY;
  ctx.orderLookups += 1;

  const d = phoneLast4.replace(/[०-९]/g, (ch) => String('०१२३४५६७८९'.indexOf(ch))).replace(/\D/g, '');
  if (d.length !== 4) {
    return { ok: false, error: 'invalid_last4', detail: 'Ask for exactly the last 4 digits.', isError: true };
  }

  const candidates = orderCandidates(orderNumber);
  if (!candidates) return { ok: true, match: false };

  // Counted before the order is read: a missing order and a real one behave the same.
  const perOrder = await deps.hitLimit(`trk:ord:${orderKey(candidates)}`, 86_400, LIMITS.maxLookupsPerOrderPerDay);
  const perIp = await deps.hitLimit(`trk:ip:${ctx.ipHash ?? UNKNOWN_IP_BUCKET}`, 3_600, LIMITS.maxLookupsPerIpPerHour);
  if (!perOrder.ok || !perIp.ok) return TOO_MANY;

  const order = await prisma.order.findFirst({
    where: { orderNumber: { in: candidates } },
    select: {
      id: true,
      orderNumber: true,
      createdAt: true,
      orderStatus: true,
      paymentStatus: true,
      paymentMethod: true,
      totalAmount: true,
      carrierName: true,
      trackingNumber: true,
      trackingUrl: true,
      shippedAt: true,
      deliveredAt: true,
      customerPhone: true,
      customer: { select: { phone: true } },
      items: { select: { productName: true, quantity: true }, take: 10 },
    },
  });
  const onFile = order ? last4(order.customerPhone) || last4(order.customer?.phone) : '';
  if (!order || !onFile || onFile !== d) return { ok: true, match: false };

  // Latest real courier scan (they carry the raw payload) - never internal notes.
  let latest: { status: string; location: string | null; at: string } | null = null;
  if (order.trackingNumber) {
    try {
      const rows = await prisma.$queryRaw<Array<{ status: string; location: string | null; occurred_at: Date }>>`
        SELECT e.status, e.location, e.occurred_at FROM shipment_events e JOIN shipments s ON s.id = e.shipment_id
         WHERE s.order_id = ${order.id} AND s.awb = ${order.trackingNumber} AND e.raw IS NOT NULL
         ORDER BY e.occurred_at DESC LIMIT 1`;
      if (rows[0]) latest = { status: rows[0].status, location: rows[0].location?.trim() || null, at: fmtDateTime(rows[0].occurred_at) };
    } catch {
      latest = null;
    }
  }

  return {
    ok: true,
    match: true,
    order_number: order.orderNumber,
    placed_on: fmtDate(order.createdAt),
    // A free replacement (lib/replacement.ts) was never paid for — say so instead of 'Paid ₹0'.
    status: order.paymentMethod === 'replacement' && !order.shippedAt && !order.deliveredAt && !['cancelled', 'returned'].includes(order.orderStatus)
      ? 'Processing - free replacement being prepared for dispatch'
      : statusLabel(order),
    payment: order.paymentMethod === 'replacement' ? 'Free replacement - no charge' : PAYMENT_LABELS[order.paymentStatus] ?? order.paymentStatus,
    shipped_on: order.shippedAt ? fmtDate(order.shippedAt) : null,
    delivered_on: order.deliveredAt ? fmtDate(order.deliveredAt) : null,
    courier: order.carrierName?.trim() || null,
    tracking_number: order.trackingNumber?.trim() || null,
    tracking_url: httpsUrl(order.trackingUrl),
    latest_update: latest,
    total_display: order.paymentMethod === 'replacement' ? 'Free replacement' : order.totalAmount != null ? formatInr(order.totalAmount) : null,
    items: order.items.map((i) => ({ name: i.productName ?? 'Item', quantity: i.quantity })),
    track_page: `${SITE_URL}/track`,
  };
}
