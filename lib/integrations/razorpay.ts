/** Razorpay integration stub. Activate by setting RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET. */
import crypto from 'node:crypto';

export const razorpayEnabled = Boolean(
  process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
);

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export async function createRazorpayOrder(amountPaise: number, receipt: string): Promise<RazorpayOrder> {
  if (!razorpayEnabled) {
    // Stub response so the rest of the flow works in dev.
    return {
      id: 'order_stub_' + crypto.randomBytes(8).toString('hex'),
      amount: amountPaise,
      currency: 'INR',
      status: 'created',
    };
  }
  const auth = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
  ).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt }),
  });
    if (!res.ok) {
    const body = await res.text();
    console.error('[razorpay] order creation failed:', res.status, body);
    throw new Error(`Razorpay order creation failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<RazorpayOrder>;
}

/** Validates the HMAC signature Razorpay sends with successful payments. */
export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!process.env.RAZORPAY_KEY_SECRET) return false;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return expected === signature;
}

export interface RazorpayPayment {
  id: string;
  order_id: string;
  /** created | authorized | captured | refunded | failed */
  status: string;
  amount: number; // paise
  /** Instrument used: upi | card | netbanking | wallet | emi | … */
  method?: string;
  /** True for international cards (Razorpay charges a higher fee). */
  international?: boolean;
  /** Total fee Razorpay charged on this payment, in paise. Includes `tax`.
   *  Populated once the payment is captured; null on authorized/failed. */
  fee?: number | null;
  /** GST portion of `fee`, in paise. */
  tax?: number | null;
  /** Card sub-details when method === 'card'. */
  card?: { network?: string; type?: string } | null;
}

/**
 * Fetch all payment attempts Razorpay recorded against one order. Source of
 * truth for reconciliation: a UPI payment can be `captured` on Razorpay even
 * when the customer's browser never returned to fire the client-side verify,
 * leaving our order stuck `pending`. Server-to-server + key-authed, so the
 * result is trustworthy (no signature needed).
 */
export async function fetchRazorpayOrderPayments(razorpayOrderId: string): Promise<RazorpayPayment[]> {
  if (!razorpayEnabled) return [];
  const auth = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
  ).toString('base64');
  const res = await fetch(
    `https://api.razorpay.com/v1/orders/${encodeURIComponent(razorpayOrderId)}/payments`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  if (!res.ok) {
    const body = await res.text();
    console.error('[razorpay] fetch order payments failed:', res.status, body);
    throw new Error(`Razorpay fetch payments failed: ${res.status}`);
  }
  const data = (await res.json()) as { items?: RazorpayPayment[] };
  return data.items || [];
}

/**
 * From all attempts on an order, pick the one that actually took the money:
 * a `captured` payment, else an `authorized` one. Returns null when nothing
 * settled (only failed/created attempts), so callers can fall back to an
 * estimate. This is the payment whose `method` (upi/card/…) and real `fee`
 * we trust for the settlement view.
 */
export function pickSettledPayment(payments: RazorpayPayment[]): RazorpayPayment | null {
  return (
    payments.find((p) => p.status === 'captured') ||
    payments.find((p) => p.status === 'authorized') ||
    null
  );
}

export interface RazorpayRefund {
  id: string;
  payment_id: string;
  amount: number; // paise
  status: string; // pending | processed | failed
}

/**
 * Refund a captured Razorpay payment. Omit `amountPaise` for a FULL refund;
 * pass it for a partial refund. Server-to-server + key-authed. Throws on a
 * non-2xx so the caller never records a refund that didn't happen.
 */
export async function createRazorpayRefund(
  paymentId: string,
  amountPaise?: number,
  notes?: Record<string, string>
): Promise<RazorpayRefund> {
  if (!razorpayEnabled) {
    throw new Error('Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing)');
  }
  const auth = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
  ).toString('base64');
  const body: Record<string, unknown> = {};
  if (amountPaise != null) body.amount = amountPaise;
  if (notes) body.notes = notes;
  const res = await fetch(
    `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    console.error('[razorpay] refund failed:', res.status, text);
    // Surface Razorpay's own error message to the admin (e.g. "already
    // refunded", "amount exceeds captured"), not a generic 500.
    let msg = `Razorpay refund failed (${res.status})`;
    try {
      const j = JSON.parse(text);
      if (j?.error?.description) msg = j.error.description;
    } catch { /* keep generic */ }
    throw new Error(msg);
  }
  return res.json() as Promise<RazorpayRefund>;
}

/**
 * Validate a Razorpay webhook: HMAC-SHA256 of the RAW request body keyed with
 * the dashboard-configured webhook secret, compared timing-safe against the
 * `x-razorpay-signature` header. Requires RAZORPAY_WEBHOOK_SECRET.
 */
export function verifyRazorpayWebhookSignature(
  rawBody: string,
  signature: string | null | undefined
): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ─────────────────────────── Payment Links ───────────────────────────
// Used when the shop takes an order FOR a customer (phone/WhatsApp order) and
// needs to collect payment afterwards. Razorpay hosts the payment page, so no
// storefront checkout is involved.

export interface RazorpayPaymentLink {
  id: string;
  short_url: string;
  status: string;          // created | paid | cancelled | expired
  amount: number;
  reference_id?: string;
}

/**
 * Create a hosted payment link for an order.
 *
 * `reference_id` carries OUR order number, which is what lets the link be
 * matched back to the order later — the link creates its own Razorpay order
 * internally, so there is no shared id to join on otherwise.
 *
 * notify.sms/email are FALSE on purpose: sending the customer a message is the
 * shop's decision, not a side effect of clicking "create". The admin gets the
 * URL and shares it themselves.
 */
export async function createRazorpayPaymentLink(args: {
  amountPaise: number;
  orderNumber: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  description?: string;
  /** Unix seconds. Razorpay requires at least 15 minutes out. */
  expireBy?: number;
}): Promise<RazorpayPaymentLink> {
  if (!razorpayEnabled) {
    return {
      id: 'plink_stub_' + crypto.randomBytes(6).toString('hex'),
      short_url: 'https://rzp.io/i/STUB' + crypto.randomBytes(3).toString('hex'),
      status: 'created',
      amount: args.amountPaise,
      reference_id: args.orderNumber,
    };
  }
  const auth = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
  ).toString('base64');

  // Razorpay rejects a contact that is not 10 digits / +91 form, and rejects
  // the whole request if `customer` carries a malformed field — so anything
  // unusable is dropped rather than sent.
  const digits = (args.customerPhone || '').replace(/\D/g, '');
  const contact = digits.length >= 10 ? digits.slice(-10) : undefined;

  const body: Record<string, unknown> = {
    amount: args.amountPaise,
    currency: 'INR',
    accept_partial: false,
    reference_id: args.orderNumber,
    description: args.description || `Order ${args.orderNumber}`,
    customer: {
      name: args.customerName || undefined,
      email: args.customerEmail || undefined,
      contact,
    },
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes: { orderNumber: args.orderNumber },
  };
  if (args.expireBy) body.expire_by = args.expireBy;

  const res = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('[razorpay] payment link creation failed:', res.status, text);
    throw new Error(`Razorpay payment link failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<RazorpayPaymentLink>;
}

/** Current state of a payment link, for reconciling an admin-created order. */
export async function fetchRazorpayPaymentLink(linkId: string): Promise<RazorpayPaymentLink & { payments?: Array<{ payment_id: string; status: string; amount: number }> }> {
  if (!razorpayEnabled) return { id: linkId, short_url: '', status: 'created', amount: 0 };
  const auth = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
  ).toString('base64');
  const res = await fetch(`https://api.razorpay.com/v1/payment_links/${linkId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Razorpay payment link fetch failed: ${res.status} ${text}`);
  }
  return res.json();
}
