import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';

/**
 * Admin dashboard stats. Fires 7 parallel queries; under concurrent dashboard
 * loads this used to saturate the Neon connection pool. Cache the response
 * for 60s so every admin session refreshes don't re-hit the DB.
 */
interface CachedStats {
  totalOrders: number;
  totalRevenue: number;
  pendingOrders: number;
  lowStockProducts: number;
  totalCustomers: number;
  totalProducts: number;
  newInquiries: number;
}

const TTL_MS = 60 * 1000;
let cache: { data: CachedStats; expires: number } | null = null;

async function compute(): Promise<CachedStats> {
  const [totalOrders, totalRevenueAgg, pendingOrders, lowStock, totalCustomers, totalProducts, totalInquiries] =
    await Promise.all([
      prisma.order.count(),
      prisma.order.aggregate({
        _sum: { totalAmount: true },
        // Revenue = money actually received (paid orders), excluding cancelled/
        // refunded. Previously this only summed orderStatus 'delivered', so
        // paid-but-not-yet-delivered orders showed ₹0 even though the money
        // was in the account.
        where: { paymentStatus: 'completed', orderStatus: { not: 'cancelled' } },
      }),
      prisma.order.count({ where: { orderStatus: { in: ['pending', 'processing'] } } }),
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint as count FROM products WHERE stock <= reorder_point AND status = 'active'
      `,
      prisma.customer.count(),
      prisma.product.count(),
      prisma.inquiry.count({ where: { status: 'new' } }),
    ]);

  return {
    totalOrders,
    totalRevenue: Number(totalRevenueAgg._sum.totalAmount ?? 0),
    pendingOrders,
    lowStockProducts: Number(lowStock[0]?.count ?? 0),
    totalCustomers,
    totalProducts,
    newInquiries: totalInquiries,
  };
}

export const GET = withAuth(async () => {
  try {
    if (cache && cache.expires > Date.now()) {
      return ok(cache.data);
    }
    const data = await compute();
    cache = { data, expires: Date.now() + TTL_MS };
    return ok(data);
  } catch (e) {
    return handleError(e);
  }
});
