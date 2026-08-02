/**
 * GET /api/sync/ping
 *
 * The handshake the partner panel's "Test connection" button calls. Proves the
 * URL points at a KitchenaryKart admin, that the API key is accepted, and
 * reports how many listings the feed will serve.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleError, ok } from '@/lib/api';
import { SYNC_SOURCE, SYNC_VERSION } from '@/lib/sync-payload';
import { syncCorsHeaders, withSyncKey } from '@/lib/sync-auth';

export const dynamic = 'force-dynamic';

export const GET = withSyncKey(async (_req: NextRequest, { caller }) => {
  try {
    const [total, active] = await Promise.all([
      prisma.product.count(),
      prisma.product.count({ where: { status: 'active' } }),
    ]);

    return ok(
      {
        ok: true,
        source: SYNC_SOURCE,
        source_label: 'KitchenaryKart',
        sync_version: SYNC_VERSION,
        connected_as: caller.name,
        key_prefix: caller.keyPrefix,
        products_total: total,
        products_active: active,
        server_time: new Date().toISOString(),
      },
      { headers: syncCorsHeaders() },
    );
  } catch (e) {
    return handleError(e);
  }
});

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: syncCorsHeaders() });
}