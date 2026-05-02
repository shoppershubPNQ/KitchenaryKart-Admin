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
      FROM products p
      LEFT JOIN order_items oi ON p.id = oi.product_id
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
