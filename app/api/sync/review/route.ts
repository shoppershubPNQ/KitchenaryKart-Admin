/** GET /api/sync/review?status=&search=&limit=&offset= — the import queue. */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { handleError, ok, paging } from '@/lib/api';
import { review, type SyncItemStatus } from '@/lib/sync-consumer';

export const dynamic = 'force-dynamic';

const STATUSES = ['all', 'new', 'matched', 'changed', 'in_sync', 'ignored', 'missing'];

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const { limit, offset } = paging(url);
    const raw = url.searchParams.get('status') ?? 'all';
    const status = (STATUSES.includes(raw) ? raw : 'all') as SyncItemStatus | 'all';

    return ok(
      await review({
        status,
        search: url.searchParams.get('search') ?? undefined,
        limit,
        offset,
      }),
    );
  } catch (e) {
    return handleError(e);
  }
});
