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
