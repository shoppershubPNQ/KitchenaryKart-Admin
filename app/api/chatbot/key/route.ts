/**
 * Dashboard -> Chatbot -> Claude API key: POST {action: set | test | clear}.
 * Admin role only. The key is encrypted before it is stored and is never
 * echoed, logged or returned - do NOT log the request body here.
 */
import { withAuth } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { adminErrorMessage, chatbotKeyAction } from '@/lib/chatbot/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// set / test make up to two Anthropic calls (lib/chatbot/claude.ts testKey).
export const maxDuration = 60;

export const POST = withAuth(async (req, { user }) => {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return fail('Invalid request.', 400);
    }
    const r = await chatbotKeyAction(raw, user.email);
    return r.ok ? ok(r.body) : fail(r.error, r.status);
  } catch (e) {
    return fail(adminErrorMessage(e, 'key action'), 500);
  }
}, ['admin']);
