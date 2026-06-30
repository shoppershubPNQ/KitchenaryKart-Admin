import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { notifyOrderStatus } from '@/lib/integrations/whatsapp';
import { sendEmail } from '@/lib/integrations/resend';
import { buildShippingNotificationEmail } from '@/lib/email-templates/shipping-notification';
import { revalidateWeb } from '@/lib/revalidateWeb';

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

    // "Save tracking" (a tracking number being added) auto-advances the
    // order to "shipped" in one step — the admin doesn't also have to
    // change the status dropdown.
    const trackingJustAdded =
      body.trackingNumber != null &&
      body.trackingNumber !== '' &&
      !current.trackingNumber &&
      current.orderStatus !== 'shipped' &&
      current.orderStatus !== 'delivered';
    const newStatus = body.orderStatus ?? (trackingJustAdded ? 'shipped' : undefined);

    // Auto-stamp shippedAt / deliveredAt on status transitions so the
    // customer-facing timeline gets accurate dates without the admin
    // needing to remember to set them manually.
    const autoStamps: { shippedAt?: Date; deliveredAt?: Date } = {};
    if (newStatus === 'shipped' && !current.shippedAt) {
      autoStamps.shippedAt = new Date();
    }
    if (newStatus === 'delivered') {
      if (!current.shippedAt) autoStamps.shippedAt = new Date();
      if (!current.deliveredAt) autoStamps.deliveredAt = new Date();
    }

    // Normalise empty strings to null so the DB doesn't end up with
    // "" rows that the storefront's `if (trackingNumber)` checks treat
    // as truthy.
    const normalised = { ...body, ...autoStamps } as Record<string, unknown>;
    if (newStatus) normalised.orderStatus = newStatus;
    for (const k of ['carrierName', 'trackingNumber', 'trackingUrl'] as const) {
      if (normalised[k] === '') normalised[k] = null;
    }

    const order = await prisma.order.update({
      where: { id },
      data: normalised as Parameters<typeof prisma.order.update>[0]['data'],
      include: { items: true },
    });

    // On delivered transition, decrement stock — the VARIANT's stock when the
    // line bought a variant (variantId set), otherwise the parent product's.
    // Previously this always hit the parent, so variant stock never moved.
    if (body.orderStatus === 'delivered' && current.orderStatus !== 'delivered') {
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
        // Audit trail keyed on the parent product (the inventory log is
        // product-level). Note the variant SKU when it's a variant line.
        if (it.productId) {
          await prisma.inventoryMovement.create({
            data: {
              productId: it.productId,
              movementType: 'stock_out',
              quantity: it.quantity,
              referenceId: `order:${order.id}`,
              notes: `Order ${order.orderNumber} delivered${it.variantId ? ` (variant ${it.productSku})` : ''}`,
            },
          });
        }
      }
      // Stock changed → refresh the storefront so the new level (incl. OOS) shows.
      await revalidateWeb('products');
    }

    const statusChanged = !!newStatus && newStatus !== current.orderStatus;

    // WhatsApp status update (existing behaviour).
    if (statusChanged && order.customerPhone) {
      notifyOrderStatus(order.customerPhone, order.orderNumber, newStatus!).catch((err) =>
        console.error('whatsapp error:', err),
      );
    }

    // Email the customer their tracking details the moment the order ships.
    if (statusChanged && newStatus === 'shipped' && order.customerEmail) {
      const mail = buildShippingNotificationEmail({
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        carrierName: order.carrierName,
        trackingNumber: order.trackingNumber,
        trackingUrl: order.trackingUrl,
        trackUrl: `https://kitchenarykart.com/account/orders/${encodeURIComponent(order.orderNumber)}`,
      });
      await sendEmail({
        to: order.customerEmail,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        category: 'shipping-notification',
      });
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
