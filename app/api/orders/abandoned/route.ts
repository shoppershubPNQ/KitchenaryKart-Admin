/**
 * GET /api/orders/abandoned
 *
 * Returns Orders that look like abandoned carts:
 *
 *   - orderStatus    = pending  (admin hasn't moved it forward)
 *   - paymentStatus  = pending  (Razorpay never confirmed)
 *   - createdAt      < (now - olderThanMinutes)  default 30
 *   - NOT cancelled (orderStatus != cancelled)
 *
 * Returns customer name + phone + items + total + age + already-
 * contacted flag so the dashboard can show a one-click WhatsApp
 * button and a "✓ Mark contacted" affordance.
 *
 * Default sort: oldest first (so you tackle the longest-stale carts
 * first when you sit down in the morning).
 *
 * Query params:
 *   olderThanMinutes  default 30, clamped to [5, 4320]  (5 min … 3 days)
 *   includeContacted  "true" to also return already-contacted carts
 *                     (default false — they're hidden from the queue)
 *   limit             default 100, max 500
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const olderThanMinutes = Math.min(
      4320,
      Math.max(5, parseInt(url.searchParams.get('olderThanMinutes') || '30', 10)),
    );
    const includeContacted = url.searchParams.get('includeContacted') === 'true';
    const limit = Math.min(
      500,
      Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10)),
    );

    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);

    const where: any = {
      orderStatus: 'pending',
      paymentStatus: 'pending',
      createdAt: { lt: cutoff },
    };
    if (!includeContacted) {
      where.contactedAt = null;
    }

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'asc' }, // oldest first
      take: limit,
      include: {
        items: {
          select: {
            id: true,
            productSku: true,
            productName: true,
            quantity: true,
            unitPrice: true,
          },
        },
      },
    });

    return ok({
      cutoff: cutoff.toISOString(),
      olderThanMinutes,
      count: orders.length,
      orders: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        customerEmail: o.customerEmail,
        shippingAddress: o.shippingAddress,
        totalAmount: o.totalAmount ? Number(o.totalAmount) : null,
        subtotal: o.subtotal ? Number(o.subtotal) : null,
        createdAt: o.createdAt,
        contactedAt: o.contactedAt,
        items: o.items.map((it) => ({
          id: it.id,
          sku: it.productSku,
          name: it.productName,
          quantity: it.quantity,
          unitPrice: it.unitPrice ? Number(it.unitPrice) : null,
        })),
      })),
    });
  } catch (e) {
    return handleError(e);
  }
});
