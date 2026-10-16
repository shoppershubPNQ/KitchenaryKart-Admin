/**
 * Dashboard -> Chatbot -> Chat logs: GET the chat list
 * (?offset=0&limit=50&filter=all|leads|errors|refusals). Admin role only.
 */
import { withAuth } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { adminErrorMessage, chatbotSessions } from '@/lib/chatbot/admin';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (req) => {
  try {
    const r = await chatbotSessions(new URL(req.url));
    return r.ok ? ok(r.body) : fail(r.error, r.status);
  } catch (e) {
    return fail(adminErrorMessage(e, 'session list'), 500);
  }
}, ['admin']);
