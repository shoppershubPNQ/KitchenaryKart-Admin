/**
 * GET /api/sync/diff/[sku]
 *
 * Field-by-field comparison for one listing, pulled live so the operator is
 * always reviewing what the partner holds right now rather than what the last
 * scan happened to catch.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { diff } from '@/lib/sync-consumer';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_req: NextRequest, { params }) => {
  try {
    const sku = decodeURIComponent(String(params?.sku ?? '')).trim();
    if (sku === '') return fail('A SKU is required', 400);
    return ok(await diff(sku));
  } catch (e) {
    return handleError(e);
  }
});
