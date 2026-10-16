/**
 * POST /api/public/chat - the website chat widget's endpoint, reached from the
 * storefront as /admin-api/public/chat (web/next.config.js rewrite; the
 * storefront's middleware.ts may add a signed visitor IP - lib/chatbot/limits.ts).
 *
 * PUBLIC and costs money per message, so the order of checks matters and every
 * step returns early: origin -> body -> sanitise -> on/off -> limits (per
 * visitor FIRST, so a client over its own limit never uses up the shared
 * budgets; then global burst, replies in flight, daily messages) -> chat
 * lookup -> daily spend with a reservation for replies in flight -> key ->
 * session claim (per chat cap + one turn at a time) -> the Claude turn ->
 * persist.
 *
 * Responses are always JSON with Cache-Control: no-store, and the widget shows
 * `reply` for every response. Error replies come from lib/chatbot/messages.ts,
 * never from an exception message. The API key never appears in a response
 * or a log line.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { LIMITS, TURN_COST_CEILING_FACTOR, TURN_COST_RESERVE_USD, type ChatModel } from './models';
import { getDecryptedApiKey, loadChatbotConfig, publicChatEnabled, setKeyStatus } from './config';
import {
  clientIp,
  hashIp,
  hitLimit,
  inFlightTurns,
  istDayKey,
  noteMissingIp,
  pruneRateLimits,
  todayCostUsd,
  UNKNOWN_IP_BUCKET,
} from './limits';
import { callClaude, makeClaudeClient, scrubSecrets, type ContentBlockParam } from './claude';
import { buildHandoff, HANDOFF_FOR, HTTP_STATUS, isHindi, messagesFor, type ErrorCode, type Handoff } from './messages';
import {
  claimSession,
  createSession,
  findReusableSession,
  loadHistory,
  persistTurn,
  recordUnpersistedCost,
  releaseSession,
  type SessionRow,
} from './store';
import { executeTool, type ToolCtx } from './tools';
import { runChatTurn, type TurnOutcome } from './turn';
import { resolveActive } from './catalog';

const MAX_BODY_BYTES = 8000;

const chatSchema = z
  .object({
    sessionId: z.string().uuid().optional(),
    /** Issued with a new chat; required to continue it (store.ts). */
    chatToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
    message: z.string(), // length checked after sanitising
    page: z.string().max(300).optional(), // location.pathname
    trackingSessionId: z.string().regex(/^[a-z0-9]{8,40}$/i).optional(),
  })
  .strict();

type ChatOk = {
  ok: true;
  sessionId: string;
  /** Only when a new chat was started - the widget keeps it with sessionId. */
  chatToken?: string;
  newSession: boolean;
  reply: string;
  handoff: Handoff | null;
  leadSaved: boolean;
  /** Messages left in this chat. */
  remaining: number;
};
type ChatErr = {
  ok: false;
  code: ErrorCode;
  reply: string;
  handoff: Handoff | null;
  sessionId?: string;
  /** When the failed turn was a new chat's first, so the widget can continue it. */
  chatToken?: string;
  retryAfterSec?: number;
  /** A lead was saved before the turn failed - the widget shows "details sent". */
  leadSaved?: boolean;
};

const NO_STORE = { 'Cache-Control': 'no-store' };

function send(body: ChatOk | ChatErr, status: number, extraHeaders: Record<string, string> = {}): Response {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...extraHeaders } });
}

function errorResponse(code: ErrorCode, hindi: boolean, extra: { sessionId?: string; retryAfterSec?: number } = {}): Response {
  const body: ChatErr = {
    ok: false,
    code,
    reply: messagesFor(hindi)[code],
    handoff: HANDOFF_FOR[code] ? buildHandoff() : null,
    ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
    ...(extra.retryAfterSec ? { retryAfterSec: extra.retryAfterSec } : {}),
  };
  return send(body, HTTP_STATUS[code], extra.retryAfterSec ? { 'Retry-After': String(extra.retryAfterSec) } : {});
}

/** The live site (both hosts), CHATBOT_ALLOWED_ORIGINS (comma list, e.g.
 *  preview domains), and any http://localhost:* outside production. A missing
 *  Origin (same-origin rewrite, curl) is allowed - the limits still apply. */
function originAllowed(origin: string): boolean {
  const norm = (s: string) => s.trim().replace(/\/+$/, '').toLowerCase();
  const o = norm(origin);
  const allowed = new Set([
    'https://kitchenarykart.com',
    'https://www.kitchenarykart.com',
    ...(process.env.CHATBOT_ALLOWED_ORIGINS || '').split(',').map(norm).filter(Boolean),
  ]);
  if (allowed.has(o)) return true;
  return process.env.NODE_ENV !== 'production' && /^http:\/\/localhost(:\d{1,5})?$/.test(o);
}

/** Normalise (NFKC folds fullwidth letters and brackets), drop invisible
 *  format characters (zero-width spaces and joiners, BOM, soft hyphen) and
 *  control characters (except \n), collapse long blank runs, trim, and
 *  neutralise anything that looks like a "[Website context]" / "[Website
 *  check]" marker - only the server may write those. */
export function sanitizeMessage(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .replace(/\[\s*w\W{0,2}e\W{0,2}b\W{0,2}s\W{0,2}i\W{0,2}t\W{0,2}e\s*(context|check)\s*\]/gi, '(website $1)')
    // Look-alike letters (e.g. a Cyrillic "е"): any short bracketed label
    // ending in "context" / "check" loses its brackets.
    .replace(/\[([^\[\]\n]{0,40}?(?:context|check))\s*\]/gi, '($1)');
}

/** "[Website context]" block for the first turn of a chat opened on a product page. */
async function pageContext(page: string): Promise<string | null> {
  const m = /^\/product\/([^/?#]{1,120})$/.exec(page);
  if (!m) return null;
  let sku: string;
  try {
    sku = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  const r = await resolveActive(sku).catch(() => null);
  if (!r) return null;
  const label = r.sizeLabel ? `${r.name} - ${r.sizeLabel}` : r.name;
  return `[Website context] The customer opened this chat on the product page for "${label}" (sku ${r.sku}).`;
}

export async function handlePublicChat(req: NextRequest): Promise<Response> {
  const started = Date.now();
  let hindi = false;
  let claimedSessionId: string | null = null;
  let persisted = false;

  try {
    // 1. Origin.
    const origin = req.headers.get('origin');
    if (origin && !originAllowed(origin)) return errorResponse('forbidden_origin', false);

    // 2. Body.
    const raw = await req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return errorResponse('too_long', false);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return errorResponse('invalid_request', false);
    }
    const parsed = chatSchema.safeParse(json);
    if (!parsed.success) return errorResponse('invalid_request', false);
    const body = parsed.data;

    // 3. Sanitise.
    const message = sanitizeMessage(body.message);
    hindi = isHindi(message);
    if (!message) return errorResponse('invalid_request', hindi);
    if (message.length > LIMITS.maxMessageChars) return errorResponse('too_long', hindi);

    // 4. On/off (one settings query; nothing is counted while the bot is off).
    const cfg = await loadChatbotConfig();
    if (!cfg.enabled) return errorResponse('disabled', hindi);
    if (!publicChatEnabled(cfg)) return errorResponse('unavailable', hindi);

    // 5. Limits (atomic Postgres counters). Per visitor network FIRST - always
    //    on (requests without any IP header share one bucket) - so a client
    //    over its own limit never touches the shared budgets below.
    const ip = clientIp(req);
    const ipHash = ip ? hashIp(ip) : null;
    if (!ipHash) noteMissingIp();
    const perIp = await hitLimit(`ip:${ipHash ?? UNKNOWN_IP_BUCKET}`, LIMITS.ipWindowSec, cfg.ipLimit);
    if (!perIp.ok) return errorResponse('rate_limited', hindi, { retryAfterSec: perIp.retryAfterSec });
    const burst = await hitLimit('global', 60, LIMITS.globalPerMinute);
    if (!burst.ok) return errorResponse('upstream_busy', hindi, { retryAfterSec: burst.retryAfterSec });
    const inFlight = await inFlightTurns();
    if (inFlight >= LIMITS.maxInFlight) return errorResponse('upstream_busy', hindi, { retryAfterSec: 15 });
    const daily = await hitLimit(`day:${istDayKey()}`, 172_800, cfg.dailyCap);
    if (!daily.ok) return errorResponse('daily_cap', hindi);
    if (Math.random() < 0.01) await pruneRateLimits().catch(() => undefined);

    // 6. The chat to continue (read only), which fixes the model.
    const existing = body.sessionId && body.chatToken ? await findReusableSession(body.sessionId, body.chatToken) : null;
    const model: ChatModel = existing?.model ?? cfg.model;

    // 7. Daily spend: what today's finished turns cost, plus a reservation for
    //    every reply still being generated (their cost is written only when
    //    they finish) and for this one.
    const reserve = TURN_COST_RESERVE_USD[model];
    if ((await todayCostUsd()) + (inFlight + 1) * reserve >= cfg.dailyCostCapUsd) return errorResponse('daily_cap', hindi);

    // 8. Key - decrypted only for a request that passed every limit.
    const apiKey = await getDecryptedApiKey();
    if (!apiKey) return errorResponse('unavailable', hindi);

    // 9. Session: reuse (atomic claim) or create.
    let session: SessionRow | null = null;
    let newSession = false;
    let chatToken: string | undefined;
    if (existing) {
      const count = await claimSession(existing.id, cfg.sessionCap);
      if (count === null) {
        return existing.userMessageCount >= cfg.sessionCap
          ? errorResponse('session_cap', hindi, { sessionId: existing.id })
          : errorResponse('busy', hindi, { sessionId: existing.id });
      }
      session = { ...existing, userMessageCount: count };
    }
    if (!session) {
      const created = await createSession({
        model,
        ipHash,
        userAgent: req.headers.get('user-agent'),
        startPath: body.page ?? null,
        trackingSessionId: body.trackingSessionId ?? null,
      });
      const { chatToken: token, ...row } = created;
      session = row;
      chatToken = token;
      newSession = true;
    }
    claimedSessionId = session.id;

    // 10. History (replay=true rows, exactly as stored).
    const { history, priorCustomerTexts } = newSession
      ? { history: [], priorCustomerTexts: [] as string[] }
      : await loadHistory(session.id);

    // 11. User content: page context on a new chat's first turn, then the text.
    const userContent: ContentBlockParam[] = [];
    if (newSession && body.page) {
      const block = await pageContext(body.page);
      if (block) userContent.push({ type: 'text', text: block });
    }
    userContent.push({ type: 'text', text: message });

    // 12. The turn, on the chat's own model.
    const ctx: ToolCtx = {
      sessionId: session.id,
      ipHash,
      customerTexts: [...priorCustomerTexts, message],
      leadInquiryId: session.leadInquiryId,
      orderLookups: session.orderLookups,
      handoff: null,
      leadSavedThisTurn: false,
    };
    const client = makeClaudeClient(apiKey);
    const outcome: TurnOutcome = await runChatTurn(
      {
        model: session.model,
        history,
        userContent,
        customerText: message,
        ctx,
        deadline: started + LIMITS.turnBudgetMs,
        hindi,
        costCeilingUsd: TURN_COST_RESERVE_USD[session.model] * TURN_COST_CEILING_FACTOR,
      },
      { callClaude: (params, timeoutMs) => callClaude(client, params, timeoutMs), executeTool, now: Date.now },
    );

    // 13. Persist (one transaction; also frees the chat for the next message).
    //     If that fails, the spend is still recorded for the daily cap.
    try {
      await persistTurn(session, outcome, { orderLookups: ctx.orderLookups, leadInquiryId: ctx.leadInquiryId });
      persisted = true;
    } catch (e) {
      await recordUnpersistedCost(session.id, outcome).catch((e2: unknown) =>
        console.error(`[chatbot] could not record the cost of an unsaved turn (session ${session!.id}): ${scrubSecrets(String(e2))}`),
      );
      console.error(`[chatbot] persist failed (session ${session.id}): ${scrubSecrets(e instanceof Error ? `${e.name}: ${e.message}` : String(e))}`);
      const MSG = messagesFor(hindi);
      return send(
        {
          ok: false,
          code: 'error',
          reply: outcome.leadSaved ? MSG.errorAfterLead : MSG.error,
          handoff: buildHandoff(),
          sessionId: session.id,
          ...(outcome.leadSaved ? { leadSaved: true } : {}),
        },
        HTTP_STATUS.error,
      );
    }

    // 14. A rejected key / billing problem: later requests short-circuit at step 4.
    if (outcome.keyStatus) {
      await setKeyStatus(outcome.keyStatus, outcome.errorLog ?? outcome.keyStatus).catch(() => undefined);
    }
    if (outcome.status === 'error') {
      console.error(`[chatbot] turn failed (session ${session.id}): ${scrubSecrets(outcome.errorLog ?? outcome.code ?? 'error')}`);
    }

    // 15. Respond.
    if (outcome.status === 'ok' || outcome.status === 'price_fallback') {
      return send(
        {
          ok: true,
          sessionId: session.id,
          ...(chatToken ? { chatToken } : {}),
          newSession,
          reply: outcome.reply,
          handoff: outcome.handoff,
          leadSaved: outcome.leadSaved,
          remaining: Math.max(0, cfg.sessionCap - session.userMessageCount),
        },
        200,
      );
    }
    const code: ErrorCode = outcome.code ?? 'error';
    return send(
      {
        ok: false,
        code,
        reply: outcome.reply,
        handoff: HANDOFF_FOR[code] ? outcome.handoff ?? buildHandoff() : null,
        sessionId: session.id,
        ...(chatToken && !outcome.closeSession ? { chatToken } : {}),
        ...(outcome.leadSaved ? { leadSaved: true } : {}),
      },
      HTTP_STATUS[code],
    );
  } catch (e) {
    console.error(`[chatbot] request failed${claimedSessionId ? ` (session ${claimedSessionId})` : ''}: ${scrubSecrets(e instanceof Error ? `${e.name}: ${e.message}` : String(e))}`);
    return errorResponse('error', hindi, claimedSessionId ? { sessionId: claimedSessionId } : {});
  } finally {
    if (claimedSessionId && !persisted) await releaseSession(claimedSessionId).catch(() => undefined);
  }
}

/** GET /api/public/chat/config - what the widget may know: on/off and the
 *  greeting. Never the model, caps or anything about the key. */
export async function handlePublicChatConfig(): Promise<Response> {
  const headers = { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' };
  try {
    const cfg = await loadChatbotConfig();
    return NextResponse.json({ enabled: publicChatEnabled(cfg), greeting: cfg.greeting }, { status: 200, headers });
  } catch {
    return NextResponse.json({ enabled: false, greeting: '' }, { status: 200, headers });
  }
}

/** Same preflight answer as app/api/public/inquiries. */
export function publicChatOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
