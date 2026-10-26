import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { applyOrderStatus } from '@/lib/order-status';
import { isReplacementOrder, REPLACEMENT_METHOD } from '@/lib/replacement';

const patchSchema = z.object({
  orderStatus: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'returned']).optional(),
  paymentStatus: z.enum(['pending', 'completed', 'failed', 'refunded']).optional(),
  paymentMethod: z.string().optional(),
  paymentReference: z.string().optional(),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
  // Internal-only actual courier cost (₹) — for the per-order profit breakdown.
  internalShippingCost: z.number().nonnegative().optional(),
  // Shipping / tracking. All optional; empty string clears the field.
  carrierName: z.string().nullable().optional(),
  trackingNumber: z.string().nullable().optional(),
  trackingUrl: z
    .string()
    .nullable()
    .optional()
    .refine((v) => !v || /^https?:\/\//i.test(v), {
      message: 'trackingUrl must start with http:// or https://',
    }),
});

export const GET = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        // include each item's product cost price (admin-only) for the profit breakdown
        items: { include: { product: { select: { id: true, costPrice: true } } } },
        payments: true,
        customer: true,
        // Free replacement links (lib/replacement.ts), both directions.
        replacementOf: { select: { id: true, orderNumber: true } },
        replacements: {
          select: { id: true, orderNumber: true, orderStatus: true, trackingNumber: true, createdAt: true },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!order) return fail('Not found', 404);
    return ok({ order });
  } catch (e) {
    return handleError(e);
  }
});

export const PATCH = withAuth(async (req, { params }) => {
  try {
    const id = parseInt(params.id);
    const body = patchSchema.parse(await req.json());

    const current = await prisma.order.findUnique({ where: { id } });
    if (!current) return fail('Not found', 404);

    // Only POST /api/orders/:id/replacement makes a replacement, and a
    // replacement's payment fields stay as created (paid, ₹0, no reference) —
    // flipping them would let it be invoiced or counted as a sale.
    if (body.paymentMethod === REPLACEMENT_METHOD && !isReplacementOrder(current)) {
      return fail('Use "Create replacement" on the original order', 400);
    }
    if (
      isReplacementOrder(current) &&
      (body.paymentStatus !== undefined || body.paymentMethod !== undefined || body.paymentReference !== undefined)
    ) {
      return fail('A free replacement has no payment to change', 400);
    }

    // "Save tracking" (a tracking number being added) auto-advances the order
    // to "shipped" in one step — the admin doesn't also have to change the
    // status dropdown.
    const trackingJustAdded =
      body.trackingNumber != null &&
      body.trackingNumber !== '' &&
      !current.trackingNumber &&
      current.orderStatus !== 'shipped' &&
      current.orderStatus !== 'delivered';
    const newStatus = body.orderStatus ?? (trackingJustAdded ? 'shipped' : undefined);

    // Every status side effect — the timeline stamps, the stock decrement on
    // delivery, WhatsApp, the shipping email, killing a live payment link —
    // lives in applyOrderStatus so the courier webhooks take exactly the same
    // path. Writing orderStatus in two places is how those effects get skipped.
    const { orderStatus, ...fields } = body;
    const { order } = await applyOrderStatus(id, newStatus ?? null, {
      fields: fields as any,
      source: 'admin',
    });

    return ok({ order });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);

export const DELETE = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    // The replacement link is ON DELETE RESTRICT (lib/replacement.ts) — say why instead of a raw FK error.
    const reps = await prisma.order.count({ where: { replacementOfId: id } });
    if (reps) return fail(`This order has ${reps} free replacement order(s) — it cannot be deleted`, 400);
    await prisma.order.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
