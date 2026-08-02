/** POST /api/sync/connection/test — round-trip the partner's /ping. */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';
import { testConnection } from '@/lib/sync-connection';

export const dynamic = 'force-dynamic';

const schema = z.object({
  baseUrl: z.string().trim().max(500).optional(),
  apiKey: z.string().trim().max(200).optional(),
});

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = schema.parse(await req.json().catch(() => ({})));
    // Reports failure rather than throwing — this is the Test button, where a
    // failure is the answer.
    return ok(await testConnection(body.baseUrl, body.apiKey));
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
