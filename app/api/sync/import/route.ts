/**
 * POST /api/sync/import
 *
 * The only route here that writes to the catalogue. Takes an explicit SKU list,
 * or `all` for everything still pending.
 *
 * The three update flags apply to UPDATES only — a newly created product always
 * takes every field, since there is nothing here to preserve.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';
import { runImport } from '@/lib/sync-consumer';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const schema = z.object({
  skus: z.array(z.string()).max(2000).optional(),
  all: z.boolean().optional(),
  onlyNew: z.boolean().optional(),
  updatePrice: z.boolean().optional(),
  updateStock: z.boolean().optional(),
  updateImages: z.boolean().optional(),
});

export const POST = withAuth(async (req: NextRequest, { user }) => {
  try {
    const body = schema.parse(await req.json());
    return ok(await runImport(body, user.id));
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);
