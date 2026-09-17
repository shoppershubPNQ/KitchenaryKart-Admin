/**
 * GET /api/analytics/export?days=28&staff=0
 *
 * Downloads the Analytics dashboard as an Excel workbook — summary, daily
 * series, every visit, paid orders, products and the breakdown tables — for
 * the owner's own analysis. Built in lib/analytics-export.ts from the same
 * functions the dashboard uses, so the file matches the screen.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { handleError } from '@/lib/api';
import { rangeDays } from '@/lib/analytics-range';
import { buildAnalyticsWorkbook } from '@/lib/analytics-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A year of visits plus every breakdown runs a few dozen queries one at a time.
export const maxDuration = 60;

export const GET = withAuth(async (req: NextRequest) => {
  try {
    // Same default as the dashboard: staff test visits out unless ?staff=1.
    const hideStaff = new URL(req.url).searchParams.get('staff') !== '1';
    const { buffer, filename } = await buildAnalyticsWorkbook(rangeDays(req), hideStaff);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return handleError(e);
  }
});
