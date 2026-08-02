/**
 * POST /api/sync/scan
 *
 * Refreshes the review queue from the partner manifest. Writes only to
 * sync_links — no product is touched.
 */
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';
import { scan } from '@/lib/sync-consumer';

export const dynamic = 'force-dynamic';
// A large partner catalogue takes longer than the platform default.
export const maxDuration = 300;

export const POST = withAuth(async (_req, { user }) => {
  try {
    return ok(await scan(user.id));
  } catch (e) {
    return handleError(e);
  }
});
