/** GET /api/sync/history — every scan and import, most recent first. */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { handleError, ok, paging } from '@/lib/api';
import { history } from '@/lib/sync-consumer';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { limit, offset } = paging(new URL(req.url));
    return ok(await history(limit, offset));
  } catch (e) {
    return handleError(e);
  }
});
