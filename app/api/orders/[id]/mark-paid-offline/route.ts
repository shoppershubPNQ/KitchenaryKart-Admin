/**
 * POST /api/orders/:id/mark-paid-offline
 *
 * Record a payment that arrived OUTSIDE Razorpay — bank transfer, UPI straight
 * to our account, cash or cheque — and finish the order exactly as a Razorpay
 * payment would: Payment row, GST invoice serial, coupon redemption, order into
 * fulfilment, and (if asked) the customer confirmation + team alert.
 *
 * It exists because the Payment status dropdown only flips a label. The first
 * case (2026-09-17, Amit Singh, KKMU3YD7BV, Rs 19,466 by IMPS) would have been
 * "paid" with no invoice number, no payment record and no email.
 *
 * Admin role only: this marks money as received. The amount must equal the
 * order total to the paisa — a paid order has to carry what actually arrived,
 * so a short or different payment is refused rather than silently accepted.
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { finalizePaidOrder } from '@/lib/order-payment';

const METHOD_LABEL = {
  bank_transfer: 'Bank transfer',
  upi_direct: 'UPI to our account',
  cash: 'Cash',
  cheque: 'Cheque',
} as const;

const bodySchema = z.object({
  method: z.enum(['bank_transfer', 'upi_direct', 'cash', 'cheque']),
  reference: z.string().trim().max(120).nullable().optional(),
  amount: z.number().positive(),
  sendEmails: z.boolean(),
});

export const POST = withAuth(async (req, { params, user }) => {
  try {
    const id = parseInt(params.id);
    if (Number.isNaN(id)) return fail('Bad order id', 400);
    const body = bodySchema.parse(await req.json());

    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, orderNumber: true, paymentStatus: true, orderStatus: true, totalAmount: true },
    });
    if (!order) return fail('Order not found', 404);
    if (order.paymentStatus === 'completed') return fail('This order is already marked paid.', 409);
    if (order.orderStatus === 'returned') {
      return fail('This order was returned — its payment needs handling by hand, not here.', 409);
    }

    const totalPaise = Math.round(Number(order.totalAmount ?? 0) * 100);
    const gotPaise = Math.round(body.amount * 100);
    if (gotPaise !== totalPaise) {
      return fail(
        `Amount ₹${gotPaise / 100} does not match the order total ₹${totalPaise / 100}. ` +
          'Correct the order first — a paid order must carry exactly what was received.',
        400,
      );
    }

    const reference = body.reference?.trim() || null;
    const when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    const note =
      `[${when} IST] Marked PAID outside Razorpay by ${user.name || user.email}: ` +
      `${METHOD_LABEL[body.method]}, ₹${totalPaise / 100}` +
      `${reference ? `, ref ${reference}` : ', no reference given'}. ` +
      `Emails ${body.sendEmails ? 'sent' : 'not sent'}.`;

    const result = await finalizePaidOrder(id, {
      source: 'offline',
      amountPaise: totalPaise,
      offline: { method: body.method, reference, note },
      sendEmails: body.sendEmails,
    });
    if (!result) return fail('Order not found', 404);
    if (result.alreadyProcessed) return fail('This order was already marked paid.', 409);

    return ok({ order: result.order });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
