import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { fail, handleError, ok } from '@/lib/api';
import { verifyRazorpayWebhookSignature } from '@/lib/integrations/razorpay';
import { finalizePaidOrder } from '@/lib/order-payment';

/**
 * Razorpay webhook — the server-side safety net.
 *
 * The client-side verify (PUT above) only fires if the customer's browser
 * returns to the site after paying. With UPI that often doesn't happen (pay in
 * the app, close the tab) — Razorpay captures the money but our order stays
 * `pending`. This webhook closes that gap: Razorpay POSTs `payment.captured`
 * server-to-server, we verify the HMAC and mark the order paid regardless of
 * the browser.
 *
 * Setup (Razorpay dashboard → Settings → Webhooks):
 *  - URL:    https://<admin-host>/api/public/payments/razorpay/webhook
 *  - Events: payment.captured
 *  - Secret: set the same value as RAZORPAY_WEBHOOK_SECRET in the admin env.
 */
export async function POST(req: NextRequest) {
  try {
    // Raw body is required — the signature is an HMAC of the exact bytes.
    const raw = await req.text();
    const sig = req.headers.get('x-razorpay-signature');
    if (!verifyRazorpayWebhookSignature(raw, sig)) return fail('Invalid signature', 400);

    const event = JSON.parse(raw) as {
      event?: string;
      payload?: {
        payment?: { entity?: { id?: string; order_id?: string; amount?: number; status?: string } };
      };
    };

    const payment = event.payload?.payment?.entity;
    if (event.event !== 'payment.captured' || !payment?.order_id || !payment.id) {
      // Not a capture we act on — ack so Razorpay stops retrying.
      return ok({ ignored: true });
    }

    // Map Razorpay's order back to ours. The razorpayOrderId was created
    // server-side with this order's exact amount, so a capture on it is
    // inherently the right money for the right order — no extra binding needed.
    const order = await prisma.order.findFirst({
      where: { razorpayOrderId: payment.order_id },
      select: { id: true },
    });
    if (!order) {
      console.warn('[razorpay-webhook] no order for razorpayOrderId', payment.order_id);
      return ok({ unmatched: true });
    }

    const result = await finalizePaidOrder(order.id, {
      razorpayPaymentId: payment.id,
      amountPaise: payment.amount ?? null,
      source: 'webhook',
    });
    return ok({ orderId: order.id, alreadyProcessed: result?.alreadyProcessed ?? false });
  } catch (e) {
    return handleError(e);
  }
}
