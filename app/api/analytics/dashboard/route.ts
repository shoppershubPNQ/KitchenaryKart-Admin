import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';
import {
  formatRange,
  isPeriodKey,
  resolvePeriod,
  type PeriodKey,
  type ResolvedPeriod,
} from '@/lib/dashboard-period';

/**
 * Admin dashboard stats. Fires a batch of parallel queries; under concurrent
 * dashboard loads this used to saturate the Neon connection pool. Cache the
 * response for 60s so every admin session refresh doesn't re-hit the DB.
 */
interface RecentOrder {
  id: number;
  orderNumber: string;
  customerName: string | null;
  totalAmount: number;
  orderStatus: string;
  paymentStatus: string;
  createdAt: Date;
}

interface TopProduct {
  id: number;
  name: string;
  unitsSold: number;
  totalRevenue: number;
}

interface CachedStats {
  /** Which window the period-scoped figures below cover. */
  period: {
    key: PeriodKey;
    label: string;
    range: string;
    compareLabel: string | null;
  };
  // Headline totals
  totalOrders: number;
  totalRevenue: number;
  totalCustomers: number;
  totalProducts: number;
  // Today
  todayOrders: number;
  todayRevenue: number;
  // Selected period vs the preceding equivalent window — drives the growth
  // indicator. Previously hard-coded to this-month vs last-month, which made
  // the number meaningless once any other range could be selected.
  periodRevenue: number;
  prevPeriodRevenue: number;
  periodOrders: number;
  periodNewCustomers: number;
  periodAvgOrderValue: number;
  // Averages (all-time)
  avgOrderValue: number;
  // Actionable queues
  pendingOrders: number;
  toShipOrders: number;
  pendingPayments: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  newInquiries: number;
  activeCoupons: number;
  // Lists
  recentOrders: RecentOrder[];
  topProducts: TopProduct[];
}

// Revenue = money actually received (paid orders), excluding cancelled/refunded.
const PAID_WHERE: Prisma.OrderWhereInput = {
  paymentStatus: 'completed',
  orderStatus: { not: 'cancelled' },
};

/** createdAt filter for a resolved window; `{}` when the window is unbounded. */
function inRange(start: Date | null, end: Date | null): Prisma.OrderWhereInput {
  if (!start) return {};
  return { createdAt: end ? { gte: start, lt: end } : { gte: start } };
}

async function compute(period: ResolvedPeriod): Promise<CachedStats> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const periodWhere = inRange(period.start, period.end);
  const prevWhere = inRange(period.prevStart, period.prevEnd);

  const [
    totalOrders,
    totalRevenueAgg,
    paidAgg,
    todayOrders,
    todayRevenueAgg,
    periodAgg,
    prevPeriodAgg,
    pendingOrders,
    toShipOrders,
    pendingPayments,
    lowStock,
    outOfStock,
    totalCustomers,
    periodNewCustomers,
    totalProducts,
    newInquiries,
    activeCoupons,
    recentOrdersRows,
    topProductRows,
  ] = await Promise.all([
    prisma.order.count(),
    prisma.order.aggregate({ _sum: { totalAmount: true }, where: PAID_WHERE }),
    // Average order value across paid orders.
    prisma.order.aggregate({ _avg: { totalAmount: true }, where: PAID_WHERE }),
    prisma.order.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: { ...PAID_WHERE, createdAt: { gte: startOfToday } },
    }),
    // Selected period: revenue, order count and average order value.
    prisma.order.aggregate({
      _sum: { totalAmount: true },
      _avg: { totalAmount: true },
      _count: { _all: true },
      where: { ...PAID_WHERE, ...periodWhere },
    }),
    prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: { ...PAID_WHERE, ...prevWhere },
    }),
    prisma.order.count({ where: { orderStatus: { in: ['pending', 'processing'] } } }),
    // Paid & ready to ship, not yet shipped.
    prisma.order.count({ where: { orderStatus: 'processing', paymentStatus: 'completed' } }),
    prisma.order.count({ where: { paymentStatus: 'pending', orderStatus: { not: 'cancelled' } } }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint as count FROM products WHERE stock <= reorder_point AND stock > 0 AND status = 'active'
    `,
    prisma.product.count({ where: { stock: { lte: 0 }, status: 'active' } }),
    prisma.customer.count(),
    prisma.customer.count({ where: inRange(period.start, period.end) as any }),
    prisma.product.count(),
    prisma.inquiry.count({ where: { status: 'new' } }),
    prisma.coupon.count({ where: { isActive: true } }),
    prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        totalAmount: true,
        orderStatus: true,
        paymentStatus: true,
        createdAt: true,
        customer: { select: { name: true } },
      },
    }),
    prisma.$queryRaw<Array<{ id: number; name: string; units_sold: bigint | null; total_revenue: number | null }>>`
      SELECT p.id, p.name,
             SUM(oi.quantity)::bigint AS units_sold,
             SUM(oi.line_total)::float AS total_revenue
      FROM products p
      JOIN order_items oi ON p.id = oi.product_id
      JOIN orders o ON o.id = oi.order_id
      -- Same rule as PAID_WHERE above: only money actually received. Without
      -- this the list counted unpaid/abandoned orders and overstated revenue.
      WHERE o.payment_status = 'completed' AND o.order_status <> 'cancelled'
      -- Scoped to the selected period, so "top products" answers "best sellers
      -- LAST YEAR" rather than always showing all-time winners.
      ${period.start ? Prisma.sql`AND o.created_at >= ${period.start} AND o.created_at < ${period.end}` : Prisma.empty}
      GROUP BY p.id
      ORDER BY total_revenue DESC NULLS LAST
      LIMIT 5
    `,
  ]);

  return {
    period: {
      key: period.key,
      label: period.label,
      range: formatRange(period),
      compareLabel: period.compareLabel,
    },
    totalOrders,
    totalRevenue: Number(totalRevenueAgg._sum.totalAmount ?? 0),
    totalCustomers,
    totalProducts,
    todayOrders,
    todayRevenue: Number(todayRevenueAgg._sum.totalAmount ?? 0),
    periodRevenue: Number(periodAgg._sum.totalAmount ?? 0),
    prevPeriodRevenue: Number(prevPeriodAgg._sum.totalAmount ?? 0),
    periodOrders: periodAgg._count._all,
    periodNewCustomers,
    periodAvgOrderValue: Number(periodAgg._avg.totalAmount ?? 0),
    avgOrderValue: Number(paidAgg._avg.totalAmount ?? 0),
    pendingOrders,
    toShipOrders,
    pendingPayments,
    lowStockProducts: Number(lowStock[0]?.count ?? 0),
    outOfStockProducts: outOfStock,
    newInquiries,
    activeCoupons,
    recentOrders: recentOrdersRows.map(o => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customerName ?? o.customer?.name ?? null,
      totalAmount: Number(o.totalAmount ?? 0),
      orderStatus: o.orderStatus,
      paymentStatus: o.paymentStatus,
      createdAt: o.createdAt,
    })),
    topProducts: topProductRows.map(r => ({
      id: r.id,
      name: r.name,
      unitsSold: Number(r.units_sold ?? 0),
      totalRevenue: Number(r.total_revenue ?? 0),
    })),
  };
}

const TTL_MS = 60 * 1000;
// Keyed BY PERIOD — a single slot would serve last year's numbers to someone
// who just switched back to this month, for up to a minute.
const cache = new Map<PeriodKey, { data: CachedStats; expires: number }>();

export const GET = withAuth(async (req) => {
  try {
    const raw = new URL(req.url).searchParams.get('period');
    const key: PeriodKey = isPeriodKey(raw) ? raw : 'this-month';

    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) {
      return ok(hit.data);
    }
    const data = await compute(resolvePeriod(key));
    cache.set(key, { data, expires: Date.now() + TTL_MS });
    return ok(data);
  } catch (e) {
    return handleError(e);
  }
});
