/**
 * Hourly: pull the latest Delhivery scans for every open shipment.
 *
 * This is how status reaches the order until Delhivery switches on the push
 * webhook — their team configures that per account (5–6 working days, and it
 * needs a live AWB to test). Once the webhook is live this keeps running as a
 * safety net; the two cannot double-apply a scan (unique index on events, and
 * orders only ever move forward).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pollOpenShipments } from '@/lib/shipments';
import { getCreds } from '@/lib/integration-credentials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (expected && req.headers.get('authorization') !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (!(await getCreds('delhivery'))) {
    return NextResponse.json({ ok: true, skipped: 'Delhivery not configured' });
  }
  try {
    const results = await pollOpenShipments(40);
    const errors = results.filter((r) => r.error);
    if (errors.length) console.warn('[shipment-poll]', errors.length, 'errors', errors.slice(0, 5));
    return NextResponse.json({ ok: true, checked: results.length, errors: errors.length, results });
  } catch (e) {
    console.error('[shipment-poll] failed', e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
