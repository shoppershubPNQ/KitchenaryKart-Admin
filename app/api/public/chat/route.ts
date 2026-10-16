/**
 * Website chat widget endpoint (public), reached from the storefront as
 * /admin-api/public/chat. All logic lives in lib/chatbot/public-chat.ts -
 * route files export only HTTP handlers and route config.
 */
import type { NextRequest } from 'next/server';
import { handlePublicChat, publicChatOptions } from '@/lib/chatbot/public-chat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  return handlePublicChat(req);
}

export async function OPTIONS() {
  return publicChatOptions();
}
