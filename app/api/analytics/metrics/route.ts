/**
 * GET /api/analytics/metrics?days=7
 *
 * GA4-style metrics for the Analytics Overview: this window vs the one before
 * it, a daily series for the chart, dimension breakdowns and a realtime card.
 * The definitions live in lib/analytics-metrics.ts.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';
import { rangeDays } from '@/lib/analytics-range';
import { getMetrics } from '@/lib/analytics-metrics';

export const dynamic = 'force-dynamic';

/**
 * 60s cache, keyed by range + staff filter. One call runs a dozen queries
 * against the analytics table; without this, two admins with the dashboard
 * open (or one refreshing) hammer the same pool the storefront's checkout
 * shares. Same guard the main dashboard route uses.
 */
const TTL_MS = 60_000;
const cache = new Map<string, { data: unknown; expires: number }>();

export const GET = withAuth(async (req: NextRequest) => {
  try {
    // Staff test visits are excluded unless ?staff=1 asks for everything.
    const hideStaff = new URL(req.url).searchParams.get('staff') !== '1';
    const days = rangeDays(req);
    const key = `${days}|${hideStaff}`;

    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return ok(hit.data);

    const data = await getMetrics(days, hideStaff);
    cache.set(key, { data, expires: Date.now() + TTL_MS });
    return ok(data);
  } catch (e) {
    return handleError(e);
  }
});
