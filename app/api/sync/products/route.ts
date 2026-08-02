/**
 * GET /api/sync/products
 *
 * The outbound catalogue feed. Read-only, API-key authenticated, paginated.
 *
 *   ?limit=  page size (default 100, max 500)
 *   ?offset= page offset
 *   ?status= active | draft | discontinued   (default: every status)
 *   ?since=  ISO timestamp — only rows updated at or after it
 *   ?sku=    comma-separated SKUs, for re-checking a specific set
 *
 * Ordered by `id` so paging stays stable while the consumer walks the pages:
 * ordering by `updatedAt` would let a row edited mid-scan jump between pages
 * and be missed entirely.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { handleError, ok } from '@/lib/api';
import { syncCorsHeaders, withSyncKey } from '@/lib/sync-auth';
import { SYNC_SOURCE, SYNC_VERSION, toSyncPayload } from '@/lib/sync-payload';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

export const GET = withSyncKey(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);

    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
    );
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

    const where: Prisma.ProductWhereInput = {};

    const status = url.searchParams.get('status')?.trim();
    if (status && ['active', 'draft', 'discontinued'].includes(status)) {
      where.status = status as any;
    }

    const since = url.searchParams.get('since')?.trim();
    if (since) {
      const parsed = new Date(since);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: 'since must be an ISO 8601 timestamp.' },
          { status: 400, headers: syncCorsHeaders() },
        );
      }
      where.updatedAt = { gte: parsed };
    }

    const skuParam = url.searchParams.get('sku')?.trim();
    if (skuParam) {
      const skus = skuParam
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
        .slice(0, MAX_LIMIT);
      where.sku = { in: skus };
    }

    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { id: 'asc' },
        take: limit,
        skip: offset,
        include: { variants: { orderBy: { id: 'asc' } } },
      }),
      prisma.product.count({ where }),
    ]);

    return ok(
      {
        source: SYNC_SOURCE,
        sync_version: SYNC_VERSION,
        total,
        limit,
        offset,
        has_more: offset + rows.length < total,
        generated_at: new Date().toISOString(),
        products: rows.map(toSyncPayload),
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
