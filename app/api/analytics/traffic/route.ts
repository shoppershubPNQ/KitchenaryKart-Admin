/**
 * GET /api/analytics/traffic?days=7
 *
 * Overview of storefront visitor analytics: totals, the checkout funnel,
 * sources, cities, devices, top pages, product interest, searches and key
 * actions. Queries live in lib/visitor-analytics.ts.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';
import { rangeDays } from '@/lib/analytics-range';
import { getTraffic } from '@/lib/visitor-analytics';

export const GET = withAuth(async (req: NextRequest) => {
  try {
    return ok(await getTraffic(rangeDays(req)));
  } catch (e) {
    return handleError(e);
  }
});
