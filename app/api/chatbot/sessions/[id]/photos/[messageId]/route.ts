/**
 * Dashboard -> Chatbot -> Chat logs: GET one customer photo (the thumbnail in
 * a transcript). Admin role only - the <img> request carries the admin cookie.
 * Served private and never cached, as an image only (nosniff + a sandboxing
 * CSP), from the stored message; there is no public URL for chat photos.
 */
import { withAuth } from '@/lib/auth';
import { fail } from '@/lib/api';
import { adminErrorMessage, chatbotPhoto } from '@/lib/chatbot/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withAuth(async (_req, { params }) => {
  try {
    const r = await chatbotPhoto(String(params?.id ?? ''), String(params?.messageId ?? ''));
    if (!r.ok) return fail(r.error, r.status);
    return new Response(new Uint8Array(r.bytes), {
      status: 200,
      headers: {
        'Content-Type': r.mediaType,
        'Content-Length': String(r.bytes.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': 'inline; filename="chat-photo"',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (e) {
    return fail(adminErrorMessage(e, 'photo'), 500);
  }
}, ['admin']);
