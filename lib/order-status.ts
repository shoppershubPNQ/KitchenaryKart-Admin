/**
 * The single place an order's status changes.
 *
 * Every status transition drags side effects behind it — shippedAt /
 * deliveredAt stamps, the stock decrement on delivery, the WhatsApp ping, the
 * shipping email, killing a live payment link on cancellation. All of that
 * used to live inside the PATCH route handler, which was fine while a human
 * clicking the dropdown was the only way a status could move.
 *
 * A courier webhook is a second way. Writing `orderStatus` from there directly
 * would silently skip every one of those effects: the customer would never get
 * their tracking email, and stock would never come down on delivery. So the
 * logic moved here and BOTH callers use it — the same correction already
 * applied to the GST report and to manual-order pricing in this codebase.
 *
 * Idempotent by design: asked for a status the order already holds, it does
 * nothing and reports `changed: false`. Couriers retry, and a replayed scan
 * must not send a second email or decrement stock twice.
 */
import type { OrderStatus, Prisma } from '@prisma/client';
import { prisma } from './db';
import { revalidateWeb } from './revalidateWeb';
import { notifyOrderStatus } from './integrations/whatsapp';
import { sendEmail } from './integrations/resend';
import { buildShippingNotificationEmail } from './email-templates/shipping-notification';
import { cancelRazorpayPaymentLink } from './integrations/razorpay';

export interface ApplyStatusOptions {
  /** Extra order fields to write in the same update — tracking number,
   *  carrier, URL. Empty strings are normalised to null. */
  fields?: Prisma.OrderUpdateInput;
  /** Where the change came from, for the logs. A webhook and a human clicking
   *  the dropdown should be tellable apart afterwards. */
  source?: 'admin' | 'webhook' | 'poll' | 'shipment';
  /** Suppress customer-facing messages. Used when a shipment booking is about
   *  to send its own, so the customer does not get two. */
  silent?: boolean;
}

export interface ApplyStatusResult {
  order: Awaited<ReturnType<typeof prisma.order.findUniqueOrThrow>>;
  changed: boolean;
  stockDecremented: boolean;
  emailSent: boolean;
}

const EMPTYABLE = ['carrierName', 'trackingNumber', 'trackingUrl'] as const;

export async function applyOrderStatus(
  orderId: number,
  next: OrderStatus | null,
  opts: ApplyStatusOptions = {},
): Promise<ApplyStatusResult> {
  const source = opts.source ?? 'admin';
  const current = await prisma.order.findUnique({ where: { id: orderId } });
  if (!current) throw new Error(`Order ${orderId} not found`);

  // Auto-stamp the timeline so the customer-facing dates are right without
  // anyone remembering to set them.
  const autoStamps: { shippedAt?: Date; deliveredAt?: Date } = {};
  if (next === 'shipped' && !current.shippedAt) autoStamps.shippedAt = new Date();
  if (next === 'delivered') {
    if (!current.shippedAt) autoStamps.shippedAt = new Date();
    if (!current.deliveredAt) autoStamps.deliveredAt = new Date();
  }

  // Empty strings become null, or the storefront's `if (trackingNumber)`
  // checks treat "" as a real tracking number.
  const data: Record<string, unknown> = { ...(opts.fields ?? {}), ...autoStamps };
  for (const k of EMPTYABLE) if (data[k] === '') data[k] = null;
  if (next) data.orderStatus = next;

  const order = await prisma.order.update({
    where: { id: orderId },
    data: data as Prisma.OrderUpdateInput,
    include: { items: true },
  });

  const changed = !!next && next !== current.orderStatus;

  // Stock comes down once, on the transition INTO delivered. Guarded on the
  // previous value so a repeated webhook cannot decrement twice.
  let stockDecremented = false;
  if (next === 'delivered' && current.orderStatus !== 'delivered') {
    for (const it of order.items) {
      if (it.variantId) {
        await prisma.productVariant.update({
          where: { id: it.variantId },
          data: { stock: { decrement: it.quantity } },
        });
      } else if (it.productId) {
        await prisma.product.update({
          where: { id: it.productId },
          data: { stock: { decrement: it.quantity } },
        });
      }
      // The inventory log is product-level; note the variant sku when the line
      // bought one.
      if (it.productId) {
        await prisma.inventoryMovement.create({
          data: {
            productId: it.productId,
            movementType: 'stock_out',
            quantity: it.quantity,
            referenceId: `order:${order.id}`,
            notes: `Order ${order.orderNumber} delivered${it.variantId ? ` (variant ${it.productSku})` : ''}${source === 'admin' ? '' : ` [${source}]`}`,
          },
        });
      }
    }
    stockDecremented = true;
    await revalidateWeb('products');
  }

  // Cancelling must also kill a live payment link, or the customer can still
  // pay an order with nothing to ship and it reads "paid" afterwards. Never
  // for an already-paid order — that is a refund, a different operation.
  if (
    next === 'cancelled' &&
    current.orderStatus !== 'cancelled' &&
    order.paymentLinkId &&
    order.paymentStatus !== 'completed'
  ) {
    try {
      const killed = await cancelRazorpayPaymentLink(order.paymentLinkId);
      console.log(
        `[order ${order.orderNumber}] cancelled — payment link ${order.paymentLinkId} ${killed ? 'cancelled' : 'could NOT be cancelled'}`,
      );
    } catch (err) {
      // Never fail a cancellation because Razorpay was unreachable.
      console.error('[razorpay] link cancel on order-cancel failed:', err);
    }
  }

  if (opts.silent) return { order, changed, stockDecremented, emailSent: false };

  // Fire-and-forget: a WhatsApp outage must not fail the status change.
  if (changed && order.customerPhone) {
    notifyOrderStatus(order.customerPhone, order.orderNumber, next!).catch((err) =>
      console.error('whatsapp error:', err),
    );
  }

  // The tracking email. Awaited on purpose — Vercel cancels in-flight fetches
  // once the response returns, so a fire-and-forget send would be dropped.
  let emailSent = false;
  if (changed && next === 'shipped' && order.customerEmail) {
    const mail = buildShippingNotificationEmail({
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      carrierName: order.carrierName,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
      trackUrl: `https://kitchenarykart.com/account/orders/${encodeURIComponent(order.orderNumber)}`,
    });
    emailSent = await sendEmail({
      to: order.customerEmail,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      category: 'shipping-notification',
    });
  }

  if (changed) {
    console.log(`[order-status] ${order.orderNumber}: ${current.orderStatus} -> ${next} (${source})`);
  }
  return { order, changed, stockDecremented, emailSent };
}
