import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';

export const GET = withAuth(async (req) => {
  try {
    const url = new URL(req.url);
    const period = (url.searchParams.get('period') || 'month') as 'week' | 'month' | 'year';
    // Whitelisted — these values are interpolated directly into SQL so they MUST come from a fixed set.
    const trunc: 'day' | 'month' = period === 'year' ? 'month' : 'day';
    const intervalDays = period === 'week' ? 14 : period === 'month' ? 60 : 365;

    const sql = `
      SELECT
        DATE_TRUNC('${trunc}', created_at) AS date,
        COALESCE(SUM(total_amount), 0)::float AS revenue,
        COUNT(*)::bigint AS orders
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '${intervalDays} days'
      GROUP BY DATE_TRUNC('${trunc}', created_at)
      ORDER BY date
    `;
    const rows = await prisma.$queryRawUnsafe<Array<{ date: Date; revenue: number; orders: bigint }>>(sql);

    return ok({
      period,
      data: rows.map(r => ({
        date: r.date,
        revenue: Number(r.revenue || 0),
        orders: Number(r.orders),
      })),
    });
  } catch (e) {
    return handleError(e);
  }
});
