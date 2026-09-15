import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';

export const GET = withAuth(async () => {
  try {
    const rows = await prisma.$queryRaw<Array<{
      id: number; sku: string; name: string; category: string | null;
      units_sold: bigint | null; total_revenue: number | null; orders_count: bigint;
    }>>`
      SELECT
        p.id, p.sku, p.name, p.category,
        SUM(oi.quantity)::bigint AS units_sold,
        SUM(oi.line_total)::float AS total_revenue,
        COUNT(DISTINCT oi.order_id)::bigint AS orders_count
      FROM order_items oi
      -- Paid, not-cancelled orders only (same rule as the dashboard's
      -- PAID_WHERE). Counting every order put two cancelled ₹1.96L test
      -- orders at the top of this list.
      JOIN orders o ON o.id = oi.order_id
        AND o.payment_status = 'completed'
        AND o.order_status <> 'cancelled'
      JOIN products p ON p.id = oi.product_id
      GROUP BY p.id
      ORDER BY total_revenue DESC NULLS LAST
      LIMIT 20
    `;
    return ok({
      products: rows.map(r => ({
        id: r.id, sku: r.sku, name: r.name, category: r.category,
        unitsSold: Number(r.units_sold ?? 0),
        totalRevenue: Number(r.total_revenue ?? 0),
        ordersCount: Number(r.orders_count),
      })),
    });
  } catch (e) {
    return handleError(e);
  }
});
