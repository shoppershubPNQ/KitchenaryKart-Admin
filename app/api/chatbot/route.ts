/**
 * Dashboard -> Chatbot: GET status (masked key, settings, usage) and PUT
 * settings. Admin role only. The API key is never returned - only its masked
 * hint (lib/chatbot/admin.ts).
 */
import { withAuth } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { adminErrorMessage, chatbotStatus, updateChatbotSettings } from '@/lib/chatbot/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// A model change in PUT runs the key test (two Anthropic calls).
export const maxDuration = 60;

export const GET = withAuth(async () => {
  try {
    return ok(await chatbotStatus());
  } catch (e) {
    return fail(adminErrorMessage(e, 'status'), 500);
  }
}, ['admin']);

export const PUT = withAuth(async (req) => {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return fail('Invalid JSON body.', 400);
    }
    const r = await updateChatbotSettings(raw);
    return r.ok ? ok(r.body, r.status ? { status: r.status } : undefined) : fail(r.error, r.status);
  } catch (e) {
    return fail(adminErrorMessage(e, 'settings update'), 500);
  }
}, ['admin']);
