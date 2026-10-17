/**
 * Chat sessions and messages: create / reuse / claim a chat, replay its
 * history, persist a finished turn, and the admin usage + log reads.
 *
 * The bot's ONLY writes are its own chat_* rows (here) and one Inquiry per
 * chat (lib/chatbot/tools.ts save_lead). Raw SQL is tagged `$queryRaw` with
 * parameters, never `Unsafe` with user input.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { isChatModel, LIMITS, type ChatModel } from './models';
import { PROMPT_VERSION, scrubSecrets, type MsgParam } from './claude';
import { istDayStartUtc } from './limits';
import { isCustomerPhotoMeta, storedPhoto } from './photo';
import type { TurnOutcome, TurnRow } from './turn';

export interface SessionRow {
  id: string;
  /** Fixed when the chat started - every turn of a chat runs on this model. */
  model: ChatModel;
  userMessageCount: number;
  leadInquiryId: number | null;
  orderLookups: number;
  handoffShown: boolean;
}

/** Hex SHA-256 of a chat token (only the hash is stored). */
const tokenHashOf = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

function tokenMatches(token: string, storedHash: string | null): boolean {
  if (!storedHash || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  return timingSafeEqual(Buffer.from(tokenHashOf(token), 'utf8'), Buffer.from(storedHash, 'utf8'));
}

/** A chat that may continue: the caller holds its chat token, it is open,
 *  same prompt version, on a known model, active in the last 12 hours. Null
 *  otherwise (the caller starts a new chat). The bare session id (it is in
 *  lead emails and admin links) is not enough to continue a chat. */
export async function findReusableSession(sessionId: string, chatToken: string): Promise<SessionRow | null> {
  const s = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      model: true,
      tokenHash: true,
      closedAt: true,
      promptVersion: true,
      updatedAt: true,
      userMessageCount: true,
      leadInquiryId: true,
      orderLookups: true,
      handoffShown: true,
    },
  });
  if (!s || !tokenMatches(chatToken, s.tokenHash)) return null;
  if (s.closedAt || s.promptVersion !== PROMPT_VERSION || !isChatModel(s.model)) return null;
  if (s.updatedAt.getTime() <= Date.now() - LIMITS.sessionIdleHours * 3600_000) return null;
  return {
    id: s.id,
    model: s.model,
    userMessageCount: s.userMessageCount,
    leadInquiryId: s.leadInquiryId,
    orderLookups: s.orderLookups,
    handoffShown: s.handoffShown,
  };
}

/** Claim an existing chat for one turn: per-chat cap + one turn at a time,
 *  atomically. With `photoCap` > 0 (the message carries a photo) the chat must
 *  also hold fewer than that many answered photos - checked in the same
 *  statement, so a photo turn that finishes just before this claim is
 *  counted. Returns the new customer-message count, or null when the chat is
 *  at a cap or a reply is still being generated. */
export async function claimSession(sessionId: string, sessionCap: number, photoCap = 0): Promise<number | null> {
  const claimed = await prisma.$queryRaw<Array<{ user_message_count: number }>>`
    UPDATE chat_sessions
       SET user_message_count = user_message_count + 1,
           busy_until = (now() AT TIME ZONE 'UTC') + interval '90 seconds',
           updated_at = (now() AT TIME ZONE 'UTC')
     WHERE id = ${sessionId}::uuid
       AND closed_at IS NULL
       AND user_message_count < ${sessionCap}
       AND (busy_until IS NULL OR busy_until < (now() AT TIME ZONE 'UTC'))
       AND (${photoCap}::int = 0 OR (
             SELECT count(*) FROM chat_messages m
              WHERE m.session_id = ${sessionId}::uuid
                AND m.kind = 'customer'
                AND m.replay = true
                AND m.tool_calls -> 'photo' IS NOT NULL
           ) < ${photoCap}::int)
    RETURNING user_message_count`;
  return claimed[0] ? Number(claimed[0].user_message_count) : null;
}

/** A new chat, already claimed for its first turn. `chatToken` goes to the
 *  widget once, in this response only; the database keeps its hash. */
export async function createSession(d: {
  model: ChatModel;
  ipHash: string | null;
  userAgent: string | null;
  startPath: string | null;
  trackingSessionId: string | null;
}): Promise<SessionRow & { chatToken: string }> {
  const chatToken = randomBytes(32).toString('base64url');
  const s = await prisma.chatSession.create({
    data: {
      id: randomUUID(),
      model: d.model,
      tokenHash: tokenHashOf(chatToken),
      promptVersion: PROMPT_VERSION,
      ipHash: d.ipHash,
      userAgent: d.userAgent?.slice(0, 300) || null,
      startPath: d.startPath?.slice(0, 300) || null,
      trackingSessionId: d.trackingSessionId,
      userMessageCount: 1,
      busyUntil: new Date(Date.now() + 90_000),
    },
    select: { id: true, userMessageCount: true, leadInquiryId: true, orderLookups: true, handoffShown: true },
  });
  return { ...s, model: d.model, chatToken };
}

/** The replayable history (replay=true rows, in order, exactly as stored) and
 *  every earlier customer text (save_lead accepts only a phone number the
 *  customer typed). Two queries, so `content` (which may hold a photo) is
 *  read only for the rows that are replayed - never for a refused or failed
 *  turn's rows. */
export async function loadHistory(sessionId: string): Promise<{ history: MsgParam[]; priorCustomerTexts: string[] }> {
  const [replayed, customer] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { sessionId, replay: true },
      orderBy: { id: 'asc' },
      select: { role: true, content: true },
    }),
    prisma.chatMessage.findMany({
      where: { sessionId, kind: 'customer' },
      orderBy: { id: 'asc' },
      select: { text: true },
    }),
  ]);
  return {
    history: replayed.map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content as unknown as MsgParam['content'] })),
    priorCustomerTexts: customer.filter((r) => r.text).map((r) => r.text as string),
  };
}

/** Photos answered in this chat: replayed customer rows with photo metadata
 *  (photo.ts CustomerPhotoMeta in tool_calls, jsonb - the image itself is not
 *  read). A photo whose turn failed or was refused (replay=false) does not
 *  count; the per-network and daily photo counters still do. Read only - the
 *  binding check is in claimSession. */
export async function countChatPhotos(sessionId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint | number }>>`
    SELECT count(*) AS n
      FROM chat_messages
     WHERE session_id = ${sessionId}::uuid
       AND kind = 'customer'
       AND replay = true
       AND tool_calls -> 'photo' IS NOT NULL`;
  return Number(rows[0]?.n ?? 0);
}

/** The log text of a customer message that was only a photo (public-chat.ts). */
export const PHOTO_ONLY_TEXT = '(photo)';

/** The customer's latest typed text in this chat (not a photo-only message's
 *  "(photo)" placeholder) - for the reply language of a photo sent without
 *  words. Read only. */
export async function lastCustomerText(sessionId: string): Promise<string | null> {
  const m = await prisma.chatMessage.findFirst({
    where: { sessionId, kind: 'customer', NOT: { text: PHOTO_ONLY_TEXT } },
    orderBy: { id: 'desc' },
    select: { text: true },
  });
  return m?.text ?? null;
}

/** Database space used by the chat log (chat_messages with its indexes and
 *  TOAST - customer photos are the largest part), in bytes. Read only. */
export async function chatLogBytes(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint | number | null }>>`
    SELECT pg_total_relation_size('chat_messages') AS n`;
  return Number(rows[0]?.n ?? 0);
}

const dec = (n: number | undefined) => new Prisma.Decimal((n ?? 0).toFixed(6));

function turnTotals(rows: TurnRow[]) {
  return rows.reduce(
    (t, r: TurnRow) => ({
      input: t.input + (r.inputTokens ?? 0),
      output: t.output + (r.outputTokens ?? 0),
      cacheRead: t.cacheRead + (r.cacheReadTokens ?? 0),
      cacheWrite: t.cacheWrite + (r.cacheWriteTokens ?? 0),
      cost: t.cost + (r.costUsd ?? 0),
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  );
}

/** Insert the turn's rows in order and update the session, in one transaction.
 *  The session's model is never changed here (it is fixed when the chat starts). */
export async function persistTurn(
  session: SessionRow,
  outcome: TurnOutcome,
  d: { orderLookups: number; leadInquiryId: number | null },
): Promise<void> {
  const totals = turnTotals(outcome.rows);

  const inserts = outcome.rows.map((r) =>
    prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: r.role,
        kind: r.kind,
        replay: r.replay,
        content: r.content as Prisma.InputJsonValue,
        text: r.text,
        ...(r.toolCalls !== undefined ? { toolCalls: r.toolCalls as Prisma.InputJsonValue } : {}),
        model: r.model?.slice(0, 40) ?? null,
        stopReason: r.stopReason?.slice(0, 40) ?? null,
        inputTokens: r.inputTokens ?? 0,
        outputTokens: r.outputTokens ?? 0,
        cacheReadTokens: r.cacheReadTokens ?? 0,
        cacheWriteTokens: r.cacheWriteTokens ?? 0,
        costUsd: dec(r.costUsd),
      },
      select: { id: true },
    }),
  );

  const update = prisma.chatSession.update({
    where: { id: session.id },
    data: {
      inputTokens: { increment: totals.input },
      outputTokens: { increment: totals.output },
      cacheReadTokens: { increment: totals.cacheRead },
      cacheWriteTokens: { increment: totals.cacheWrite },
      costUsd: { increment: dec(totals.cost) },
      leadInquiryId: d.leadInquiryId,
      orderLookups: d.orderLookups,
      handoffShown: session.handoffShown || outcome.handoff != null,
      lastError:
        outcome.status === 'error'
          ? scrubSecrets(outcome.errorLog ?? outcome.code ?? 'error').slice(0, 500)
          : outcome.bindingNote
            ? outcome.bindingNote.slice(0, 500)
            : null,
      ...(outcome.closeSession ? { closedAt: new Date() } : {}),
      busyUntil: null,
    },
    select: { id: true },
  });

  await prisma.$transaction([...inserts, update]);
}

/**
 * persistTurn failed: still record what the turn cost (one replay=false row
 * holding only the usage), so the daily spend cap - which sums
 * chat_messages.cost_usd - never misses tokens Anthropic billed.
 */
export async function recordUnpersistedCost(sessionId: string, outcome: TurnOutcome): Promise<void> {
  const t = turnTotals(outcome.rows);
  if (t.cost <= 0 && t.input + t.output + t.cacheRead + t.cacheWrite === 0) return;
  await prisma.chatMessage.create({
    data: {
      sessionId,
      role: 'assistant',
      kind: 'reply',
      replay: false,
      content: [],
      text: null,
      stopReason: 'persist_failed',
      inputTokens: t.input,
      outputTokens: t.output,
      cacheReadTokens: t.cacheRead,
      cacheWriteTokens: t.cacheWrite,
      costUsd: dec(t.cost),
    },
    select: { id: true },
  });
}

/** Free the chat after a failed persist, so the customer is not stuck on "busy". */
export async function releaseSession(sessionId: string): Promise<void> {
  await prisma.$executeRaw`UPDATE chat_sessions SET busy_until = NULL WHERE id = ${sessionId}::uuid`;
}

// ------------------------------------------------------------ admin reads

async function usageSince(since: Date, withIps: boolean) {
  const [messages, sessions, leads, sums, ips] = await Promise.all([
    prisma.chatMessage.count({ where: { kind: 'customer', createdAt: { gte: since } } }),
    prisma.chatSession.count({ where: { createdAt: { gte: since } } }),
    prisma.chatSession.count({ where: { leadInquiryId: { not: null }, updatedAt: { gte: since } } }),
    prisma.chatMessage.aggregate({
      where: { createdAt: { gte: since } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, costUsd: true },
    }),
    withIps
      ? prisma.$queryRaw<Array<{ n: bigint | number }>>`SELECT count(DISTINCT ip_hash) AS n FROM chat_sessions WHERE created_at >= ${since}`
      : Promise.resolve(null),
  ]);
  return {
    messages,
    sessions,
    leads,
    ...(ips ? { distinctIps: Number(ips[0]?.n ?? 0) } : {}),
    inputTokens: sums._sum.inputTokens ?? 0,
    outputTokens: sums._sum.outputTokens ?? 0,
    cacheReadTokens: sums._sum.cacheReadTokens ?? 0,
    cacheWriteTokens: sums._sum.cacheWriteTokens ?? 0,
    costUsd: Number(sums._sum.costUsd ?? 0),
  };
}

/** Today (IST day) and the last 7 days. */
export async function usageSummary() {
  const todayStart = istDayStartUtc();
  const weekStart = new Date(todayStart.getTime() - 6 * 24 * 3600_000);
  const [today, last7Days] = await Promise.all([usageSince(todayStart, true), usageSince(weekStart, false)]);
  return { today: today as typeof today & { distinctIps: number }, last7Days };
}

export type SessionFilter = 'all' | 'leads' | 'errors' | 'refusals';

const LIST_SELECT = {
  id: true,
  createdAt: true,
  updatedAt: true,
  model: true,
  userMessageCount: true,
  costUsd: true,
  leadInquiryId: true,
  handoffShown: true,
  startPath: true,
  lastError: true,
  messages: { where: { kind: 'customer' }, orderBy: { id: 'asc' }, take: 1, select: { text: true } },
} satisfies Prisma.ChatSessionSelect;

function filterWhere(filter: SessionFilter): Prisma.ChatSessionWhereInput {
  if (filter === 'leads') return { leadInquiryId: { not: null } };
  if (filter === 'errors') return { lastError: { not: null } };
  if (filter === 'refusals') return { messages: { some: { stopReason: { startsWith: 'refusal' } } } };
  return {};
}

function listRow<T extends Prisma.ChatSessionGetPayload<{ select: typeof LIST_SELECT }>>(s: T) {
  const { messages, costUsd, ...rest } = s;
  const first = messages[0]?.text ?? null;
  return { ...rest, costUsd: Number(costUsd), firstMessage: first ? first.slice(0, 100) : null };
}

export async function listSessions(o: { offset: number; limit: number; filter: SessionFilter }) {
  const where = filterWhere(o.filter);
  const [total, rows] = await Promise.all([
    prisma.chatSession.count({ where }),
    prisma.chatSession.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: o.offset, take: o.limit, select: LIST_SELECT }),
  ]);
  return { total, sessions: rows.map(listRow) };
}

/** One transcript for the admin log. Never returns `content` (thinking
 *  signatures, raw blocks, photo bytes): a customer photo is flagged from the
 *  row's metadata and fetched separately (getCustomerPhoto, admin only). */
export async function getSessionTranscript(id: string) {
  const s = await prisma.chatSession.findUnique({
    where: { id },
    select: {
      ...LIST_SELECT,
      ipHash: true,
      userAgent: true,
      trackingSessionId: true,
      orderLookups: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheWriteTokens: true,
    },
  });
  if (!s) return null;
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId: id },
    orderBy: { id: 'asc' },
    select: { id: true, role: true, kind: true, replay: true, text: true, toolCalls: true, model: true, stopReason: true, costUsd: true, createdAt: true },
  });
  return {
    session: listRow(s),
    messages: messages.map((m) => {
      const meta = m.kind === 'customer' && isCustomerPhotoMeta(m.toolCalls) ? m.toolCalls : null;
      const used = meta && Array.isArray(meta.photoHints?.used) ? meta.photoHints.used.filter((x) => typeof x === 'string') : [];
      return {
        ...m,
        id: Number(m.id),
        costUsd: Number(m.costUsd),
        photo: meta
          ? { mediaType: meta.photo.mediaType, bytes: Number(meta.photo.bytes) || 0, width: Number(meta.photo.width) || 0, height: Number(meta.photo.height) || 0, hints: used }
          : null,
      };
    }),
  };
}

/** The photo of one customer row, for the admin-only photo route. Selects
 *  `content` of that single row only; null when the row is not a customer
 *  message of this chat or holds no valid image. */
export async function getCustomerPhoto(sessionId: string, messageId: bigint) {
  const m = await prisma.chatMessage.findFirst({
    where: { id: messageId, sessionId, kind: 'customer' },
    select: { content: true },
  });
  return m ? storedPhoto(m.content) : null;
}
