import { withAuth } from '@/lib/auth';
import { ok, handleError } from '@/lib/api';
import { prisma } from '@/lib/db';

/**
 * Per-order profit source data for the Profit Calculator.
 *
 * Returns recent PAID orders with the raw sums needed to compute profit with
 * the same method as the manual calculator (selling price is GST-inclusive;
 * the GST on the cost is claimable ITC). The final Razorpay fee + net profit +
 * margin are computed client-side so they follow the page's Razorpay % input.
 *
 * `costMissing` flags orders that contain a product with no cost price set —
 * their profit can't be trusted until the cost is filled in.
 */
export const GET = withAuth(async (req) => {
  try {
    const url = new URL(req.url);
    const take = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '40', 10)));

    const orders = await prisma.order.findMany({
      where: { paymentStatus: 'completed' },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        orderNumber: true,
        customerName: true,
        createdAt: true,
        totalAmount: true,
        items: {
          select: {
            unitPrice: true,
            quantity: true,
            taxPercent: true,
            lineTotal: true,
            product: { select: { costPrice: true } },
          },
        },
      },
    });

    const rows = orders.map((o) => {
      let revenueIncl = 0; // product revenue (GST-inclusive)
      let costIncl = 0;    // total cost incl GST
      let gstCollected = 0;
      let itc = 0;
      let costMissing = false;

      for (const it of o.items) {
        const line = it.lineTotal != null ? Number(it.lineTotal) : Number(it.unitPrice) * it.quantity;
        const tax = Number(it.taxPercent ?? 18);
        const basic = line / (1 + tax / 100);
        revenueIncl += line;
        gstCollected += line - basic;

        const cp = it.product?.costPrice != null ? Number(it.product.costPrice) : null;
        if (cp == null) { costMissing = true; continue; }
        const costBase = cp * it.quantity;
        const gstOnCost = (costBase * tax) / 100;
        costIncl += costBase + gstOnCost;
        itc += gstOnCost;
      }

      return {
        orderNumber: o.orderNumber,
        date: o.createdAt,
        customer: o.customerName,
        totalAmount: o.totalAmount != null ? Number(o.totalAmount) : revenueIncl,
        revenueIncl,
        costIncl,
        gstCollected,
        itc,
        items: o.items.length,
        costMissing,
      };
    });

    return ok({ orders: rows });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'accounts']);
