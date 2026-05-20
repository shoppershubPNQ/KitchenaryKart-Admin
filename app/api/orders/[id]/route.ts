import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { notifyOrderStatus } from '@/lib/integrations/whatsapp';

const patchSchema = z.object({
  orderStatus: z.enum(['pending', 'processing', 'shipped', 'delivered', 'cancelled']).optional(),
  paymentStatus: z.enum(['pending', 'completed', 'failed', 'refunded']).optional(),
  paymentMethod: z.string().optional(),
  paymentReference: z.string().optional(),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
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
      include: { items: true, payments: true, customer: true },
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

    // Auto-stamp shippedAt / deliveredAt on status transitions so the
    // customer-facing timeline gets accurate dates without the admin
    // needing to remember to set them manually.
    const autoStamps: { shippedAt?: Date; deliveredAt?: Date } = {};
    if (body.orderStatus === 'shipped' && !current.shippedAt) {
      autoStamps.shippedAt = new Date();
    }
    if (body.orderStatus === 'delivered') {
      if (!current.shippedAt) autoStamps.shippedAt = new Date();
      if (!current.deliveredAt) autoStamps.deliveredAt = new Date();
    }

    // Normalise empty strings to null so the DB doesn't end up with
    // "" rows that the storefront's `if (trackingNumber)` checks treat
    // as truthy.
    const normalised = { ...body, ...autoStamps } as Record<string, unknown>;
    for (const k of ['carrierName', 'trackingNumber', 'trackingUrl'] as const) {
      if (normalised[k] === '') normalised[k] = null;
    }

    const order = await prisma.order.update({
      where: { id },
      data: normalised as Parameters<typeof prisma.order.update>[0]['data'],
      include: { items: true },
    });

    // On delivered transition, decrement stock
    if (body.orderStatus === 'delivered' && current.orderStatus !== 'delivered') {
      for (const it of order.items) {
        if (it.productId) {
          await prisma.product.update({
            where: { id: it.productId },
            data: { stock: { decrement: it.quantity } },
          });
          await prisma.inventoryMovement.create({
            data: {
              productId: it.productId,
              movementType: 'stock_out',
              quantity: it.quantity,
              referenceId: `order:${order.id}`,
              notes: `Order ${order.orderNumber} delivered`,
            },
          });
        }
      }
    }

    // Notify customer if status moved
    if (body.orderStatus && body.orderStatus !== current.orderStatus && order.customerPhone) {
      notifyOrderStatus(order.customerPhone, order.orderNumber, body.orderStatus).catch(err =>
        console.error('whatsapp error:', err)
      );
    }

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
