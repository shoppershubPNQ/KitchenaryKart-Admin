/**
 * Nightly: refresh the Hotelic Essentials import queue.
 *
 * A scan writes ONLY to sync_links — it never creates or changes a product.
 * Importing stays a decision someone makes on the Sync page; this just makes
 * sure the queue is current when they get there.
 *
 * Why it exists: the scan used to run only when an operator clicked it, so a
 * listing added on their side sat unseen until someone happened to look. On
 * 23 Sep 2026 the last scan was thirteen days old and 434 listings had
 * accumulated, several added that same week.
 */
import { NextRequest, NextResponse } from 'next/server';
import { scan } from '@/lib/sync-consumer';
import { connectionStatus } from '@/lib/sync-connection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (expected && req.headers.get('authorization') !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // Nothing configured is a normal state, not a failure — the connection
  // ships blank and is filled in on the Sync page.
  const status = await connectionStatus();
  if (!status.configured) {
    return NextResponse.json({ ok: true, skipped: 'partner catalogue not connected' });
  }

  try {
    const result = await scan(null);
    return NextResponse.json({
      ok: true,
      examined: result.examined,
      pending: result.pending,
      counts: result.counts,
      message: result.message,
    });
  } catch (e: any) {
    // The partner being unreachable is their outage, not ours: report it and
    // let the next run pick it up rather than failing loudly every night.
    console.warn('[partner-scan]', e?.message ?? e);
    return NextResponse.json({ ok: false, error: e?.message ?? 'scan failed' }, { status: 502 });
  }
}
