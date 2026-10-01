/**
 * Hourly: pull the latest scans for every open shipment, both couriers.
 *
 * This is how status reaches the order until the couriers' push webhooks are
 * switched on — Delhivery's team configures theirs per account (5–6 working
 * days, needs a live AWB). Once a webhook is live this keeps running as a
 * safety net; the two cannot double-apply a scan (unique index on events, and
 * orders only ever move forward).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pollOpenShipments } from '@/lib/shipments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (expected && req.headers.get('authorization') !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    // Couriers that are not connected are skipped inside.
    const results = await pollOpenShipments(40);
    const errors = results.filter((r) => r.error);
    if (errors.length) console.warn('[shipment-poll]', errors.length, 'errors', errors.slice(0, 5));
    return NextResponse.json({ ok: true, checked: results.length, errors: errors.length, results });
  } catch (e) {
    console.error('[shipment-poll] failed', e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
