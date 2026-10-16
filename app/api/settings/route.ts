import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { HE_WATCH_KEY } from '@/lib/he-price-watch';
import { CHATBOT_SETTING_PREFIX } from '@/lib/chatbot/models'; // 'chatbot_' (no-deps module)

// Rows owned by their own pages, kept off this plain key/value editor: the HE API key (lib/sync-connection.ts,
// only ever shown masked on the Sync page), the HE price-watch snapshot + per-user "seen" rows, which a
// hand edit would break, and the website chatbot's rows (encrypted Anthropic key + its settings -
// lib/chatbot/config.ts, edited only on Dashboard → Chatbot).
const HE_API_KEY = 'sync_he_api_key';
const isManagedElsewhere = (key: string) =>
  key === HE_API_KEY || key.startsWith(HE_WATCH_KEY) || key.startsWith(CHATBOT_SETTING_PREFIX);

// Admin only: the Settings page is the only caller, and its link is admin-only.
export const GET = withAuth(async () => {
  try {
    const rows = await prisma.setting.findMany({
      where: {
        NOT: [{ key: HE_API_KEY }, { key: { startsWith: HE_WATCH_KEY } }, { key: { startsWith: CHATBOT_SETTING_PREFIX } }],
      },
      orderBy: { key: 'asc' },
    });
    return ok({ settings: rows });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);

const upsertSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  dataType: z.string().optional(),
});

export const PUT = withAuth(async (req) => {
  try {
    const body = upsertSchema.parse(await req.json());
    if (isManagedElsewhere(body.key)) return fail('This setting is managed on its own page.', 400);
    const setting = await prisma.setting.upsert({
      where: { key: body.key },
      update: { value: body.value, dataType: body.dataType },
      create: body,
    });
    return ok({ setting });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
