/**
 * Daily: look for Hotelic Essentials price rises (07:45 IST, after partner-scan).
 *
 * Compares every active size with HE's feed and stores what it finds in the
 * settings row he_price_watch, which the admin pop-up reads. It never changes
 * a product — the owner chose "only notify me" (16 Oct 2026), so raising a
 * price stays a decision someone makes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { connectionStatus } from '@/lib/sync-connection';
import { computeHeIncreases, saveHeWatch } from '@/lib/he-price-watch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (expected && req.headers.get('authorization') !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // No connection is a normal state, not a failure — it is filled in on the Sync page.
  const status = await connectionStatus();
  if (!status.configured) {
    return NextResponse.json({ ok: true, skipped: 'partner catalogue not connected' });
  }

  try {
    const snapshot = await computeHeIncreases();
    await saveHeWatch(snapshot);
    return NextResponse.json({
      ok: true,
      increases: snapshot.total,
      gstDiffers: snapshot.gstDiffers,
      examined: snapshot.examined,
    });
  } catch (e: any) {
    // HE unreachable, or a feed that came back empty or cut short: keep
    // yesterday's snapshot and let the next run pick it up. If it keeps
    // failing, the pop-up says the check has stopped (36 h, see the API).
    console.warn('[he-price-watch]', e?.message ?? e);
    return NextResponse.json({ ok: false, error: e?.message ?? 'price check failed' }, { status: 502 });
  }
}
