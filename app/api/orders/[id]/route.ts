import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { applyOrderStatus } from '@/lib/order-status';

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
    await prisma.order.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
