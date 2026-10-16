/**
 * GET {enabled, greeting} for the website chat widget (public). Never the
 * model, caps or key data. force-dynamic so it is never pre-rendered at build
 * time (that would query the database during the build).
 */
import { handlePublicChatConfig } from '@/lib/chatbot/public-chat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return handlePublicChatConfig();
}
