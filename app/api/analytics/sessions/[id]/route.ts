/**
 * GET /api/analytics/sessions/<sessionId>
 *
 * Step-by-step timeline of one visit: every page with the time it was on
 * screen and how far it was scrolled, every product viewed, cart change,
 * checkout step, payment attempt and WhatsApp / call tap — plus who the
 * visitor is (once they have ordered) and how many visits they have made.
 * Queries live in lib/visitor-analytics.ts.
 */
import { withAuth } from '@/lib/auth';
import { handleError, fail, ok } from '@/lib/api';
import { getSessionDetail } from '@/lib/visitor-analytics';

export const GET = withAuth(async (_req, { params }) => {
  try {
    const id = String(params.id || '');
    if (!/^[a-z0-9]{8,40}$/i.test(id)) return fail('Bad session id', 400);
    const detail = await getSessionDetail(id);
    if (!detail) return fail('Session not found', 404);
    return ok(detail);
  } catch (e) {
    return handleError(e);
  }
});
