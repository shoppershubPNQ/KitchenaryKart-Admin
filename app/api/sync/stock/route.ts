/**
 * GET /api/sync/stock
 *
 * Stock only: every listing's SKU and quantity, product and variant alike,
 * so a partner that treats THIS panel as the stock ledger can mirror it
 * without pulling names, prices or images. Read-only, API-key authenticated,
 * paginated.
 *
 *   ?limit=  page size (default 1000, max 5000)
 *   ?offset= page offset
 *   ?since=  ISO timestamp — only products whose row changed at or after it.
 *            A variant's stock changing does not always touch the product's
 *            updated_at, so a consumer that wants every quantity walks the
 *            feed without `since`.
 *
 * Unlike /products there is NO loop guard: a listing imported from the partner
 * still has ITS stock here, and that number is exactly what the partner is
 * asking for. Ordered by id so paging stays stable mid-walk.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { handleError, ok } from '@/lib/api';
import { syncCorsHeaders, withSyncKey } from '@/lib/sync-auth';
import { composeVariantSku, SYNC_SOURCE, SYNC_VERSION } from '@/lib/sync-payload';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 5000;
const DEFAULT_LIMIT = 1000;

export const GET = withSyncKey(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
    );
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

    const where: Prisma.ProductWhereInput = {};
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

    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { id: 'asc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          sku: true,
          stock: true,
          status: true,
          updatedAt: true,
          variants: { orderBy: { id: 'asc' }, select: { id: true, skuSuffix: true, stock: true } },
        },
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
        items: rows.map((product) => ({
          external_id: product.id,
          sku: product.sku,
          status: product.status,
          stock: Number(product.stock) || 0,
          updated_at: product.updatedAt.toISOString(),
          variants: product.variants.map((variant) => ({
            external_id: variant.id,
            sku: composeVariantSku(product.sku, variant.skuSuffix, variant.id),
            sku_suffix: variant.skuSuffix?.trim() || null,
            stock: Number(variant.stock) || 0,
          })),
        })),
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
