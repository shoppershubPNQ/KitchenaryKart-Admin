/**
 * GET /api/sync/manifest
 *
 * The cheap scan primitive: one row per listing carrying just enough to render
 * the partner's review table (name, price, cover image, variant count) plus the
 * `content_hash` that decides new / changed / in-sync.
 *
 * The consumer scans against this, then pulls full payloads from
 * /api/sync/products?sku=… only for the rows it actually imports — so a repeat
 * scan of a settled catalogue costs one small response instead of every image
 * URL and variant in the system.
 *
 *   ?status= active | draft | discontinued   (default: every status)
 *
 * Unpaginated by design, capped at MAX_ROWS. The consumer needs the WHOLE set
 * in one shot to tell "deleted upstream" from "on another page".
 */
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { handleError, ok } from '@/lib/api';
import { syncCorsHeaders, withSyncKey } from '@/lib/sync-auth';
import { SYNC_SOURCE, SYNC_VERSION, toSyncPayload } from '@/lib/sync-payload';

export const dynamic = 'force-dynamic';

const MAX_ROWS = 5000;

export const GET = withSyncKey(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const where: Prisma.ProductWhereInput = {};

    const status = url.searchParams.get('status')?.trim();
    if (status && ['active', 'draft', 'discontinued'].includes(status)) {
      where.status = status as any;
    }

    const total = await prisma.product.count({ where });
    const rows = await prisma.product.findMany({
      where,
      orderBy: { id: 'asc' },
      take: MAX_ROWS,
      include: { variants: { orderBy: { id: 'asc' } } },
    });

    // The hash must be computed over the SAME payload /api/sync/products emits,
    // otherwise every product would read as "changed" the moment it is imported.
    const entries = rows.map((row) => {
      const payload = toSyncPayload(row);
      return {
        external_id: payload.external_id,
        sku: payload.sku,
        product_code: payload.product_code,
        name: payload.name,
        status: payload.status,
        price: payload.price,
        mrp: payload.mrp,
        stock: payload.stock,
        category_path: payload.category_path,
        image: payload.images[0] ?? null,
        image_count: payload.images.length,
        variant_count: payload.variants.length,
        content_hash: payload.content_hash,
        updated_at: payload.updated_at,
      };
    });

    return ok(
      {
        source: SYNC_SOURCE,
        source_label: 'KitchenaryKart',
        sync_version: SYNC_VERSION,
        total,
        returned: entries.length,
        truncated: total > entries.length,
        generated_at: new Date().toISOString(),
        products: entries,
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
