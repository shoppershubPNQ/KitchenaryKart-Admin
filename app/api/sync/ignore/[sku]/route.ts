/** PUT /api/sync/ignore/[sku] — dismiss a listing, or restore it. */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { setIgnored } from '@/lib/sync-consumer';

export const dynamic = 'force-dynamic';

const schema = z.object({ ignored: z.boolean().optional() });

export const PUT = withAuth(async (req: NextRequest, { params }) => {
  try {
    const sku = decodeURIComponent(String(params?.sku ?? '')).trim();
    if (sku === '') return fail('A SKU is required', 400);
    const body = schema.parse(await req.json().catch(() => ({})));
    return ok(await setIgnored(sku, body.ignored !== false));
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);
