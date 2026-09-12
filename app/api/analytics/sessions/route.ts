/**
 * GET /api/analytics/sessions?days=7&filter=all|engaged|cart|checkout|payment|buyers|known&hideStaff=1
 *
 * One row per visit: when, who (customer name once that visitor has placed an
 * order), where from, device, pages, products viewed, active time on site and
 * how far into checkout they got. Newest first, up to 150.
 * Queries live in lib/visitor-analytics.ts.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';
import { rangeDays } from '@/lib/analytics-range';
import { getSessions } from '@/lib/visitor-analytics';

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    return ok(
      await getSessions(
        rangeDays(req),
        url.searchParams.get('filter') || 'all',
        url.searchParams.get('hideStaff') !== '0',
      ),
    );
  } catch (e) {
    return handleError(e);
  }
});
