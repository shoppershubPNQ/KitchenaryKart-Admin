import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { sendEmail } from '@/lib/integrations/resend';
import { buildOrderConfirmationEmail } from '@/lib/email-templates/order-confirmation';

/**
 * Re-send the order-confirmation email to the order's CURRENT customer email —
 * for when the email was corrected after payment (owner 2026-10-09: KKMV0QOC30
 * was placed with the team's address and paid before the buyer's was set). Same
 * template, sender and fields as the confirmation finalizePaidOrder sends.
 * Paid orders only.
 */
export const POST = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    if (!Number.isFinite(id)) return fail('Bad id', 400);
    const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) return fail('Order not found', 404);
    if (order.paymentStatus !== 'completed') return fail('Only a paid order has a confirmation to send', 400);
    if (!order.customerEmail) return fail('This order has no customer email', 400);

    const { subject, html, text } = buildOrderConfirmationEmail({
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      totalAmount: Number(order.totalAmount || 0),
      subtotal: Number(order.subtotal || 0),
      taxAmount: Number(order.taxAmount || 0),
      shippingCost: Number(order.shippingCost || 0),
      shippingAddress: order.shippingAddress,
      paymentReference: order.paymentReference,
      items: order.items.map((it) => ({
        name: it.productName || '',
        sku: it.productSku || '',
        quantity: it.quantity,
        unitPrice: Number(it.unitPrice),
        lineTotal: Number(it.lineTotal),
      })),
    });
    const sent = await sendEmail({ to: order.customerEmail, subject, html, text, category: 'order-confirmation' });
    if (!sent) return fail('The email service did not accept the message — try again in a minute', 502);
    return ok({ sentTo: order.customerEmail });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);
