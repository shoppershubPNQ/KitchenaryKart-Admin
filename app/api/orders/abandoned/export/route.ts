/**
 * GET /api/orders/abandoned/export?days=7
 *
 * Unpaid website checkouts (buyer reached Razorpay, did not pay) as an Excel
 * call list for the sales team: order no., IST time, buyer, phone, email,
 * city/state, items, amount, minutes since checkout, WhatsApp link.
 * Staff test checkouts and buyers who paid later are left out — the rules
 * live in lib/unpaid-checkouts.ts (unit-tested). Read-only.
 *
 * days: 1 | 7 | 30 | 90 (default 7).
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { handleError } from '@/lib/api';
import { periodDays, unpaidCheckoutsExcel } from '@/lib/unpaid-checkouts-load';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const days = periodDays(new URL(req.url).searchParams.get('days'));
    const { buffer, filename } = await unpaidCheckoutsExcel(days);
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
