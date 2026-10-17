/**
 * POST /api/public/chat - the website chat widget's endpoint, reached from the
 * storefront as /admin-api/public/chat (web/next.config.js rewrite; the
 * storefront's middleware.ts may add a signed visitor IP - lib/chatbot/limits.ts).
 *
 * PUBLIC and costs money per message, so the order of checks matters and every
 * step returns early: origin -> body -> sanitise + photo check -> on/off ->
 * limits (per visitor FIRST, so a client over its own limit never uses up the
 * shared budgets; then global burst, replies in flight, daily messages) -> chat
 * lookup -> per-chat photo cap (quick read) -> daily spend with a reservation
 * for replies in flight -> key -> session claim (per chat cap + one turn at a
 * time + per-chat photo cap, atomically) -> per-network / daily photo counters
 * (only for a photo that will reach Claude) -> the Claude turn -> persist.
 *
 * Responses are always JSON with Cache-Control: no-store, and the widget shows
 * `reply` for every response. Error replies come from lib/chatbot/messages.ts,
 * never from an exception message. The API key never appears in a response
 * or a log line.
 *
 * Photos (optional `image`, one per message): validated in lib/chatbot/photo.ts
 * (allow-listed type, magic bytes, byte and pixel caps), capped per chat / per
 * visitor network / per day, refused while the model takes no image input
 * (the admin key Test, config photosEnabled), and sent to Claude as a base64
 * image block followed by a "[Website photo context]" text block that lists
 * the widget's photo-search SKUs (`photoMatches`) re-validated against active
 * products. The image block is stored in the customer row's content like any
 * other block, so the history stays append-only and is replayed byte for byte.
 * Base64 in chat_messages rather than the Files API because: uploaded files
 * cannot be downloaded back, and the admin log needs our own copy anyway (the
 * Files API would mean two copies plus delete handling, and a deleted file_id
 * - or one lost when the organisation's 100 GB file storage is cleaned up -
 * would break every later replay of that chat; files persist until deleted,
 * typescript/claude-api/files-api.md); the Files API also does not reduce the
 * tokens an image costs (shared/preserved-thinking-migration.md, images option
 * (d)), and the bundled reference names base64 as a safe way to reference an
 * image across turns (shared/model-migration.md, "Referencing an
 * image/document by URL across turns"); with prompt caching the replayed
 * image is mostly a cache read. Cost: about 0.4 MB of database per photo, at
 * most 2 answered per chat (Dashboard -> Chatbot shows the chat log's size).
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
import { buildHandoff, HANDOFF_FOR, HTTP_STATUS, isHindi, messagesFor, type ErrorCode, type Handoff, type Messages } from './messages';
import {
  claimSession,
  countChatPhotos,
  createSession,
  findReusableSession,
  lastCustomerText,
  loadHistory,
  persistTurn,
  PHOTO_ONLY_TEXT,
  recordUnpersistedCost,
  releaseSession,
  type SessionRow,
} from './store';
import { executeTool, type ToolCtx } from './tools';
import { runChatTurn, type TurnOutcome } from './turn';
import { resolveActive, resolvePhotoHints } from './catalog';
import { checkPhoto, cleanHintSkus, MAX_PHOTO_BODY_BYTES, type CheckedPhoto, type CustomerPhotoMeta } from './photo';

/** A request without a photo. */
const MAX_BODY_BYTES = 8000;

const chatSchema = z
  .object({
    sessionId: z.string().uuid().optional(),
    /** Issued with a new chat; required to continue it (store.ts). */
    chatToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
    // Exact length checked after sanitising; may be empty with a photo. The
    // bound here only keeps a photo request (whose body may be larger) from
    // pushing a huge string through sanitizeMessage.
    message: z.string().max(MAX_BODY_BYTES),
    page: z.string().max(300).optional(), // location.pathname
    trackingSessionId: z.string().regex(/^[a-z0-9]{8,40}$/i).optional(),
    /** One photo per message, base64 without the data: prefix. Only the shape
     *  is checked here; type allow-list, base64, magic bytes and size are
     *  checked by photo.ts checkPhoto so they answer photo_invalid. */
    image: z
      .object({
        mediaType: z.string().max(40),
        data: z.string().max(MAX_PHOTO_BODY_BYTES),
      })
      .strict()
      .optional(),
    /** SKUs from the website's photo search for this photo - hints only; up
     *  to 8 are used, each re-validated (cleanHintSkus + resolvePhotoHints). */
    photoMatches: z.array(z.string().max(120)).max(24).optional(),
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

function errorResponse(
  code: ErrorCode,
  hindi: boolean,
  extra: { sessionId?: string; retryAfterSec?: number; /** Another text for this code (photo_busy). */ reply?: keyof Messages } = {},
): Response {
  const body: ChatErr = {
    ok: false,
    code,
    reply: messagesFor(hindi)[extra.reply ?? code],
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
 *  photo context]" / "[Website check]" marker - only the server may write
 *  those. */
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

/** "[Website photo context]" block, placed right after the image. The marker
 *  ends in "context", so sanitizeMessage strips it from customer text. Names
 *  and size labels are from the database (resolvePhotoHints). */
export function photoContext(hints: Array<{ sku: string; name: string; sizeLabel: string | null }>, photoOnly: boolean): string {
  const head = photoOnly
    ? '[Website photo context] The customer sent this photo without a message.'
    : '[Website photo context] The customer sent this photo together with a message.';
  if (!hints.length) {
    return `${head} No photo-search suggestions came with it: use search_products with words for what you see.`;
  }
  const lines = hints.map((h) => `- ${h.sizeLabel ? `${h.name} - ${h.sizeLabel}` : h.name} (sku ${h.sku})`);
  return [
    `${head} The website's photo search found these catalogue items that look similar. They are visual hints, not verified matches:`,
    ...lines,
    'Check a sku with get_product_details before you name, price or recommend it, and never call it an exact match unless its details agree with the photo.',
  ].join('\n');
}

/** The request body as text, or null when it is over `cap` bytes (by
 *  Content-Length, or while streaming when the header is missing or wrong). */
async function readBodyCapped(req: NextRequest, cap: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > cap) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
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

    // 2. Body: read with a hard cap (a photo request is larger), then the
    //    usual 8,000-byte cap for a request without a photo.
    const raw = await readBodyCapped(req, MAX_PHOTO_BODY_BYTES);
    if (raw === null) return errorResponse('photo_invalid', false);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return errorResponse('invalid_request', false);
    }
    // Without a photo the whole body is capped at 8,000 bytes (checked before
    // the schema, so a long text answers too_long); with one, everything
    // except the base64 is.
    const rawBytes = Buffer.byteLength(raw, 'utf8');
    const hasImageKey = typeof json === 'object' && json !== null && 'image' in json;
    if (!hasImageKey && rawBytes > MAX_BODY_BYTES) return errorResponse('too_long', false);
    const parsed = chatSchema.safeParse(json);
    if (!parsed.success) return errorResponse('invalid_request', false);
    const body = parsed.data;
    if (body.image && rawBytes - body.image.data.length > MAX_BODY_BYTES) return errorResponse('too_long', false);

    // 3. Sanitise. A message may be empty only when it carries a photo.
    const message = sanitizeMessage(body.message);
    hindi = isHindi(message);
    if (!message && !body.image) return errorResponse('invalid_request', hindi);
    if (message.length > LIMITS.maxMessageChars) return errorResponse('too_long', hindi);

    // 3b. Photo: allow-listed type, magic bytes, byte and pixel caps.
    let photo: CheckedPhoto | null = null;
    if (body.image) {
      const c = checkPhoto(body.image.mediaType, body.image.data);
      if (!c.ok) {
        console.warn(`[chatbot] photo rejected: ${c.reason}`);
        return errorResponse('photo_invalid', hindi);
      }
      photo = c.photo;
    }

    // 4. On/off (one settings query; nothing is counted while the bot is off).
    const cfg = await loadChatbotConfig();
    if (!cfg.enabled) return errorResponse('disabled', hindi);
    if (!publicChatEnabled(cfg)) return errorResponse('unavailable', hindi);
    // The admin key Test found that the model takes no image input (the
    // widget hides its camera then; this catches an older open page). Code
    // photo_invalid (the photo is not retried), wording "photos can't be sent
    // right now".
    if (photo && !cfg.photosEnabled) return errorResponse('photo_invalid', hindi, { reply: 'photo_busy' });

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
    // A photo sent without words: reply (and refuse) in the language of the
    // customer's last typed message in this chat.
    if (!message && existing) {
      const last = await lastCustomerText(existing.id).catch(() => null);
      if (last) hindi = isHindi(last);
    }

    // 6b. Per-chat photo cap, quick read-only check before the chat is
    //     claimed (so a refused photo uses up no message). The binding check
    //     is part of the claim in step 9. A new chat starts at 0.
    if (photo && existing && (await countChatPhotos(existing.id)) >= LIMITS.maxPhotosPerChat) {
      return errorResponse('photo_limit', hindi, { sessionId: existing.id });
    }

    // 7. Daily spend: what today's finished turns cost, plus a reservation for
    //    every reply still being generated (their cost is written only when
    //    they finish) and for this one.
    const reserve = TURN_COST_RESERVE_USD[model];
    if ((await todayCostUsd()) + (inFlight + 1) * reserve >= cfg.dailyCostCapUsd) return errorResponse('daily_cap', hindi);

    // 8. Key - decrypted only for a request that passed every limit.
    const apiKey = await getDecryptedApiKey();
    if (!apiKey) return errorResponse('unavailable', hindi);

    // 8b. Per visitor network per hour and per IST day for the whole website:
    //     counted only for a photo that will reach Claude (after every free
    //     refusal above, and for an existing chat after its claim), so photo
    //     posts that are refused anyway never use up these budgets. The reply
    //     says "not right now" (photo_busy), not the per-chat wording.
    const photoCountersRefusal = async (sessionId?: string): Promise<Response | null> => {
      if (!photo) return null;
      const ipPhotos = await hitLimit(`photo-ip:${ipHash ?? UNKNOWN_IP_BUCKET}`, 3600, LIMITS.maxPhotosPerIpPerHour);
      if (!ipPhotos.ok) {
        return errorResponse('photo_limit', hindi, { sessionId, retryAfterSec: ipPhotos.retryAfterSec, reply: 'photo_busy' });
      }
      const dayPhotos = await hitLimit(`photo-day:${istDayKey()}`, 172_800, LIMITS.maxPhotosPerDay);
      if (!dayPhotos.ok) return errorResponse('photo_limit', hindi, { sessionId, reply: 'photo_busy' });
      return null;
    };

    // 9. Session: reuse (atomic claim: message cap, one turn at a time and,
    //    with a photo, the per-chat photo cap) or create.
    let session: SessionRow | null = null;
    let newSession = false;
    let chatToken: string | undefined;
    if (existing) {
      const count = await claimSession(existing.id, cfg.sessionCap, photo ? LIMITS.maxPhotosPerChat : 0);
      if (count === null) {
        if (photo && (await countChatPhotos(existing.id)) >= LIMITS.maxPhotosPerChat) {
          return errorResponse('photo_limit', hindi, { sessionId: existing.id });
        }
        return existing.userMessageCount >= cfg.sessionCap
          ? errorResponse('session_cap', hindi, { sessionId: existing.id })
          : errorResponse('busy', hindi, { sessionId: existing.id });
      }
      // Claimed: from here every return frees the chat again (finally).
      claimedSessionId = existing.id;
      const refused = await photoCountersRefusal(existing.id);
      if (refused) return refused;
      session = { ...existing, userMessageCount: count };
    } else {
      const refused = await photoCountersRefusal();
      if (refused) return refused;
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

    // 11. User content: [image, photo context] when there is a photo (images
    //     work best before text), then page context on a new chat's first
    //     turn, then the customer's text (none for a photo-only message).
    const userContent: ContentBlockParam[] = [];
    let customerMeta: CustomerPhotoMeta | undefined;
    if (photo) {
      const hintSkus = cleanHintSkus(body.photoMatches);
      const hints = hintSkus.length ? await resolvePhotoHints(hintSkus).catch(() => []) : [];
      userContent.push({ type: 'image', source: { type: 'base64', media_type: photo.mediaType, data: photo.data } });
      userContent.push({ type: 'text', text: photoContext(hints, !message) });
      customerMeta = {
        photo: { mediaType: photo.mediaType, bytes: photo.bytes, width: photo.width, height: photo.height },
        photoHints: { sent: body.photoMatches?.length ?? 0, used: hints.map((h) => h.sku) },
      };
    }
    if (newSession && body.page) {
      const block = await pageContext(body.page);
      if (block) userContent.push({ type: 'text', text: block });
    }
    if (message) userContent.push({ type: 'text', text: message });

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
        customerText: message || PHOTO_ONLY_TEXT,
        customerMeta,
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

/** GET /api/public/chat/config - what the widget may know: on/off, the
 *  greeting and whether photos are accepted (the camera button). Never the
 *  model, caps or anything about the key. */
export async function handlePublicChatConfig(): Promise<Response> {
  const headers = { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' };
  try {
    const cfg = await loadChatbotConfig();
    const enabled = publicChatEnabled(cfg);
    return NextResponse.json({ enabled, greeting: cfg.greeting, photos: enabled && cfg.photosEnabled }, { status: 200, headers });
  } catch {
    return NextResponse.json({ enabled: false, greeting: '', photos: false }, { status: 200, headers });
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
