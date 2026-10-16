/**
 * Dashboard -> Chatbot -> Chat logs: GET one transcript. Admin role only.
 * Never returns the raw message content (thinking signatures, raw blocks).
 */
import { withAuth } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { adminErrorMessage, chatbotTranscript } from '@/lib/chatbot/admin';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_req, { params }) => {
  try {
    const r = await chatbotTranscript(String(params?.id ?? ''));
    return r.ok ? ok(r.body) : fail(r.error, r.status);
  } catch (e) {
    return fail(adminErrorMessage(e, 'transcript'), 500);
  }
}, ['admin']);
