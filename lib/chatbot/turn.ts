/**
 * One customer turn of the website chatbot: the manual tool loop.
 *
 * A manual loop rather than the SDK tool runner (tool-use-concepts.md -> Tool
 * Runner vs Manual Loop) because this route needs control the runner does not
 * give: persist only finished turns, force a text-only final call after the
 * tool budget, replay the stored history byte-for-byte, and run the price
 * guard.
 *
 * Dependencies are injected (callClaude, executeTool, now) so the loop can be
 * tested with a fake Claude and no database (scripts/_tmp-chatbot-selftest.ts).
 *
 * History is APPEND-ONLY: every response is appended exactly as returned
 * (minus fallback artefacts), rows of a refused / failed turn are marked
 * replay=false so they are never sent again, and nothing earlier is ever
 * edited - the preserved-thinking rule (model-migration.md -> Fable 5.1 from
 * Fable 5 -> Breaking change 3). Every response's `input_transformations`
 * (thinking blocks the API dropped under drop_block) is logged.
 */
import { LIMITS, type ChatModel } from './models';
import {
  buildParams,
  classifyTurnError,
  extractReplyText,
  isBadRequest,
  MAX_TOKENS,
  MAX_TOKENS_RETRY,
  PhotoRejected,
  sanitizeAssistantContent,
  scrubSecrets,
  stripThinking,
  TurnFailure,
  TurnTimeout,
  type BetaMessage,
  type ContentBlockParam,
  type CreateParams,
  type MsgParam,
} from './claude';
import { addUsage, usageOf, ZERO_USAGE, type TurnUsage } from './pricing';
import { buildHandoff, messagesFor, type ErrorCode, type Handoff } from './messages';
import { formatInr } from './catalog';
import { redactForLog, toAsciiDigits, type ToolCtx, type ToolOutcome } from './tools';

export interface TurnDeps {
  callClaude(params: CreateParams, timeoutMs: number): Promise<BetaMessage>;
  executeTool(name: string, input: unknown, ctx: ToolCtx): Promise<ToolOutcome>;
  now(): number;
}

export interface TurnInput {
  model: ChatModel;
  /** replay=true rows, exactly as stored. */
  history: MsgParam[];
  /** [photo + photo context?] + [page context?] + the customer's text block
   *  (no text block for a photo-only message). */
  userContent: ContentBlockParam[];
  customerText: string;
  /** Stored as the customer row's tool_calls (photo metadata for the admin
   *  log and the per-chat photo count). Customer rows have no tool calls. */
  customerMeta?: unknown;
  ctx: ToolCtx;
  /** Epoch ms. */
  deadline: number;
  /** Pick the Hindi customer messages. */
  hindi: boolean;
  /** USD. Past this the next call is text-only; past twice this the turn
   *  fails. 0 = no ceiling. */
  costCeilingUsd: number;
}

/** One chat_messages insert. */
export interface TurnRow {
  role: 'user' | 'assistant';
  kind: 'customer' | 'tool_call' | 'tool_result' | 'reply' | 'guard';
  replay: boolean;
  content: unknown;
  text: string | null;
  toolCalls?: unknown;
  model?: string;
  stopReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
}

export interface TurnOutcome {
  status: 'ok' | 'refused' | 'error' | 'price_fallback';
  code?: ErrorCode;
  keyStatus?: 'invalid' | 'billing';
  closeSession?: boolean;
  errorLog?: string;
  reply: string;
  rows: TurnRow[];
  handoff: Handoff | null;
  leadSaved: boolean;
  /** Thinking blocks the API dropped (or let through) under the binding check, this turn. */
  bindingDrops: number;
  /** Set when a drop points at a changed history (prefix_binding_mismatch) - a harness bug. */
  bindingNote?: string;
}

// ----------------------------------------------------------- price guard

const NUM = '([0-9][0-9,]*(?:\\.[0-9]{1,2})?)';
/**
 * A rupee amount: ₹ / Rs / INR / rupees before a number; /- / rupees /
 * rupaye / रुपये after it; "sirf 4500"; "4500 mein de denge". Applied after
 * Devanagari digits are turned into ASCII.
 */
const AMOUNT_RE = new RegExp(
  [
    `(?:₹|\\brs\\.?|\\binr\\b|\\brupees?\\b)\\s*${NUM}`,
    `${NUM}\\s*(?:\\/-|\\brupees?\\b|\\brupaye\\b|\\brupay\\b|रुपये|रुपए|रुपया|रु\\.?)`,
    `(?:\\bsirf\\b|\\bsrf\\b|सिर्फ|केवल)\\s*${NUM}`,
    `${NUM}\\s*(?:me|mein|mai|main|में)\\s+(?:de|dey|denge|dunga|dungi|doge|milega|mil\\s+jayega|mil\\s+jaega|दे|देंगे|दूंगा|दूँगा|मिलेगा|मिल\\s+जाएगा)`,
  ].join('|'),
  'gi',
);

/** Every rupee amount in `text`, as integer paise. */
export function amountsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of toAsciiDigits(text).matchAll(AMOUNT_RE)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').replace(/,/g, '');
    const x = Number(raw);
    if (raw && Number.isFinite(x)) out.push(Math.round(x * 100));
  }
  return out;
}

const PCT_RE = /(\d{1,3}(?:\.\d+)?)\s*(?:%|percent(?![a-z])|per\s+cent(?![a-z])|प्रतिशत|pratishat(?![a-z])|फ़ीसदी|फीसदी|fisadi(?![a-z]))/gi;

/** Every percentage in `text`. */
export function percentsIn(text: string): number[] {
  return [...toAsciiDigits(text).matchAll(PCT_RE)].map((m) => Number(m[1])).filter((x) => Number.isFinite(x));
}

/** GST slabs (old and current) and "100%" - other percentages must come from a tool result. */
const ALWAYS_ALLOWED_PERCENTS = [0, 5, 12, 18, 28, 40, 100];

const WORD_AMOUNT_RE = /(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|लाख|crores?|करोड़|करोड|thousand|hazaa?r|हज़ार|हजार|k)(?![a-z0-9])/gi;

/** Amounts in words or short form ("1.2 lakh", "45k"), normalised ("1.2lakh"). */
export function wordAmountsIn(text: string): string[] {
  return [...toAsciiDigits(text).matchAll(WORD_AMOUNT_RE)].map((m) => {
    const unit = m[2].toLowerCase().replace(/^lacs?$|^lakhs$|^लाख$/, 'lakh').replace(/^crores$|^करोड़?$/, 'crore');
    return `${m[1]}${unit}`;
  });
}

const DISCOUNT_WORD_RE = /discount|disc\.|छूट|छुट|chhoot|chhut|डिस्काउंट|कम\s*कर|kam\s*kar|concession|rebate|cash\s*back/gi;
const OFF_RE = /\d\s*%\s*off(?![a-z])|(?:₹|\brs\.?|\binr\b)\s*[0-9][0-9,]*\s*off(?![a-z])|\d\s*(?:rupees?|rupaye|रुपये)\s*off(?![a-z])|\boff\s*(?:₹|rs\b|inr\b)/i;

/** A discount / "off" / concession word within 10 characters of a number. */
export function mentionsDiscountAmount(text: string): boolean {
  const t = toAsciiDigits(text);
  if (OFF_RE.test(t)) return true;
  for (const m of t.matchAll(DISCOUNT_WORD_RE)) {
    const i = m.index ?? 0;
    const near = t.slice(Math.max(0, i - 10), i) + ' ' + t.slice(i + m[0].length, i + m[0].length + 10);
    if (/\d/.test(near)) return true;
  }
  return false;
}

/** ₹5,000 and ₹10,000 - the free-delivery thresholds the prompt states. */
const ALWAYS_ALLOWED = [500000, 1000000];

function toolResultTexts(messages: MsgParam[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type !== 'tool_result') continue;
      if (typeof b.content === 'string') out.push(b.content);
      else if (Array.isArray(b.content)) {
        for (const c of b.content) if (c.type === 'text') out.push(c.text);
      }
    }
  }
  return out;
}

interface GuardFindings {
  amounts: number[];
  percents: number[];
  words: string[];
  discount: boolean;
}

/**
 * The deterministic backstop for the owner rule "never invent a price or
 * promise a discount": every rupee amount must come from a tool result in this
 * chat (or be a free-delivery threshold) - NOT from the customer's own words,
 * so "can you do ₹9,000?" -> "OK, ₹9,000" is caught; every percentage must be
 * a GST rate or appear in a tool result; amounts in words / short form are
 * never allowed unless a tool result has the same; and no discount word may
 * sit next to a number.
 */
export function checkReply(text: string, messages: MsgParam[]): GuardFindings | null {
  const tools = toolResultTexts(messages);
  const allowedAmounts = new Set<number>([...ALWAYS_ALLOWED, ...tools.flatMap(amountsIn)]);
  const allowedPercents = new Set<number>([...ALWAYS_ALLOWED_PERCENTS, ...tools.flatMap(percentsIn)]);
  const allowedWords = new Set<string>(tools.flatMap(wordAmountsIn));
  const f: GuardFindings = {
    amounts: [...new Set(amountsIn(text).filter((a) => !allowedAmounts.has(a)))],
    percents: [...new Set(percentsIn(text).filter((p) => !allowedPercents.has(p)))],
    words: [...new Set(wordAmountsIn(text).filter((w) => !allowedWords.has(w)))],
    discount: mentionsDiscountAmount(text),
  };
  return f.amounts.length || f.percents.length || f.words.length || f.discount ? f : null;
}

function guardNote(f: GuardFindings): string {
  const parts: string[] = [];
  if (f.amounts.length) {
    parts.push(
      `it contains an amount (${f.amounts.map((p) => formatInr(p / 100)).join(', ')}) that is not in any tool result in this chat. Prices may only be copied from price_display, mrp_display, price_range or total_display values returned by the tools. Do not repeat amounts the customer typed - say the team will confirm`,
    );
  }
  if (f.words.length) parts.push(`it writes an amount in words or short form (${f.words.join(', ')}) - copy price_display exactly instead`);
  if (f.percents.length) parts.push(`it contains a percentage (${f.percents.map((p) => `${p}%`).join(', ')}) that is not a GST rate or in a tool result`);
  if (f.discount) {
    parts.push('it puts a discount, "off" or price-reduction word next to a number. You cannot give or promise any discount or special price; say the team confirms these personally, without any number');
  }
  return `[Website check] Your last reply broke a rule: ${parts.join('; ')}. Rewrite your reply: call search_products or get_product_details if you need a price, or leave the amount out and offer the team.`;
}

// ----------------------------------------------------------------- loop

const MAX_CALLS = LIMITS.maxToolRounds + 5; // tool rounds + text-only call + max_tokens retry + guard retry + 400 retry + slack

type ThinkingDrop = { type: string; reason?: string; path?: string };
const KNOWN_DROP_TYPES = new Set(['thinking_dropped', 'thinking_mismatch_allowed']);

export async function runChatTurn(input: TurnInput, deps: TurnDeps): Promise<TurnOutcome> {
  const { model, ctx, deadline } = input;
  const MSG = messagesFor(input.hindi);
  const messages: MsgParam[] = [...input.history, { role: 'user', content: input.userContent }];
  const rows: TurnRow[] = [
    {
      role: 'user',
      kind: 'customer',
      replay: true,
      content: input.userContent,
      text: input.customerText,
      ...(input.customerMeta !== undefined ? { toolCalls: input.customerMeta } : {}),
    },
  ];
  const forget = () => rows.forEach((r) => (r.replay = false));

  let rounds = 0;
  let calls = 0;
  let guardUsed = false;
  let retriedMaxTokens = false;
  let strippedHistory = false;
  /** The customer sent a photo with this message. */
  const turnHasImage = input.userContent.some((b) => b.type === 'image');
  /** Claude has answered at least one request of this turn (so it accepted the photo). */
  let gotResponse = false;
  let turnCost = 0;
  let bindingDrops = 0;
  let bindingNote: string | undefined;
  /** Usage of responses no row has recorded yet - written by the catch block
   *  if the turn fails before a row takes it, so billed tokens are never lost. */
  let pendingUsage: TurnUsage = ZERO_USAGE;
  const ceiling = input.costCeilingUsd;

  try {
    for (;;) {
      if (deps.now() > deadline - 3000) throw new TurnTimeout();
      if (++calls > MAX_CALLS) throw new TurnFailure('too many model calls in one turn');
      if (ceiling > 0 && turnCost >= ceiling * 2) throw new TurnFailure(`turn cost ceiling reached ($${turnCost.toFixed(4)})`);

      // Tool budget spent, or this turn already cost more than its ceiling:
      // the next call must answer in text.
      const noMoreTools = rounds >= LIMITS.maxToolRounds || (ceiling > 0 && turnCost >= ceiling);
      const params = buildParams(model, messages, {
        maxTokens: retriedMaxTokens ? MAX_TOKENS_RETRY : MAX_TOKENS,
        noMoreTools,
      });

      let res: BetaMessage;
      try {
        res = await deps.callClaude(params, Math.min(25_000, deadline - deps.now()));
      } catch (e) {
        // A 400 before Claude answered anything in a turn that carries a NEW
        // photo (a file with a valid header but broken image data, an odd
        // encoding, a model without image input): only this photo failed, so
        // answer photo_invalid and keep the chat (the turn's rows are stored
        // with replay=false, so the history stays append-only and the photo is
        // not counted as answered). With a history, the replayed-history
        // retry below runs first - the 400 may be the history's fault, and
        // stripping it then lets the photo through; if the retry is refused
        // too, it is the photo. A new chat has no history to blame.
        if (isBadRequest(e) && turnHasImage && !gotResponse && (strippedHistory || input.history.length === 0)) {
          throw new PhotoRejected(scrubSecrets(e instanceof Error ? e.message : String(e)));
        }
        // A 400 on a request whose only other variable part is the replayed
        // history (e.g. a thinking signature that no longer verifies, always
        // a 400 whatever drop_block says): the documented one-time recovery is
        // to strip every thinking block from the history and retry once. A
        // second 400 is classified below and closes the chat (or, in a photo
        // turn, is answered as photo_invalid above).
        if (!strippedHistory && input.history.length > 0 && isBadRequest(e)) {
          strippedHistory = true;
          messages.splice(0, messages.length, ...stripThinking(messages));
          console.warn(
            `[chatbot] 400 on a replayed history${turnHasImage && !gotResponse ? ' (this message has a photo, which may be the cause)' : ''} - retrying once without thinking blocks (session ${ctx.sessionId})`,
          );
          continue;
        }
        throw e;
      }
      gotResponse = true;

      const raw = usageOf(res, model);
      turnCost += raw.costUsd;
      const u = addUsage(raw, pendingUsage);
      pendingUsage = u; // until a row records it

      // drop_block is on: log every block the binding check dropped or let
      // through (model-migration.md -> the three-step check, step 3).
      const drops = ((res as { input_transformations?: ThinkingDrop[] | null }).input_transformations ?? []).filter((t) =>
        KNOWN_DROP_TYPES.has(t.type),
      );
      if (drops.length) {
        bindingDrops += drops.length;
        const desc = drops.map((d) => `${d.type === 'thinking_dropped' ? 'drop' : 'allow'}:${d.reason ?? '?'}@${d.path ?? '?'}`).join(', ');
        console.warn(`[chatbot] thinking binding (session ${ctx.sessionId}): ${desc}`);
        // model_binding_mismatch = a server-side fallback switched models
        // (expected); prefix_binding_mismatch = the history changed (a bug).
        if (drops.some((d) => d.reason === 'prefix_binding_mismatch')) {
          bindingNote = `thinking binding mismatch (history changed): ${desc}`.slice(0, 300);
        }
      }
      const stop = (s: string | null | undefined) => `${s ?? 'none'}${drops.length ? '+drop' : ''}`;

      // Refusal: branch on stop_reason, never on stop_details. The refused
      // text is never shown and the model forgets the turn.
      if (res.stop_reason === 'refusal') {
        forget();
        const reply = ctx.leadSavedThisTurn ? MSG.errorAfterLead : MSG.refused;
        rows.push({
          role: 'assistant',
          kind: 'reply',
          replay: false,
          content: [],
          text: reply,
          model: res.model,
          stopReason: `refusal:${res.stop_details?.category ?? 'none'}`.slice(0, 40),
          ...u,
        });
        return {
          status: 'refused',
          code: 'refused',
          reply,
          rows,
          handoff: buildHandoff(),
          leadSaved: ctx.leadSavedThisTurn,
          bindingDrops,
          bindingNote,
        };
      }

      // Stopped on max_tokens (a reply cut off mid-sentence, thinking used the
      // budget, or a tool input may be cut off): retry ONCE with a bigger
      // budget WITHOUT appending, so the history stays append-only. Cut off
      // again -> the turn fails rather than show or store a truncated reply.
      if (res.stop_reason === 'max_tokens') {
        if (!retriedMaxTokens) {
          retriedMaxTokens = true;
          continue; // pendingUsage keeps this response's usage
        }
        throw new TurnFailure('reply cut off at max_tokens after retry');
      }
      if (res.stop_reason === 'pause_turn') throw new TurnFailure('unexpected pause_turn (no server tools are declared)');

      const content = sanitizeAssistantContent(res.content);
      const toolUses = content.filter((b): b is Extract<ContentBlockParam, { type: 'tool_use' }> => b.type === 'tool_use');

      // Tools run only on stop_reason tool_use; any other stop is terminal
      // (the reference loop), and tool_use blocks under it are never executed.
      if (toolUses.length > 0 && res.stop_reason !== 'tool_use') {
        throw new TurnFailure(`unexpected stop ${res.stop_reason} with tool_use`);
      }
      if (toolUses.length === 0 && res.stop_reason !== 'end_turn' && res.stop_reason !== 'stop_sequence') {
        throw new TurnFailure(`unexpected stop ${res.stop_reason}`);
      }

      messages.push({ role: 'assistant', content });

      if (toolUses.length > 0) {
        if (noMoreTools) throw new TurnFailure('tool_use returned with tool_choice none');
        rows.push({
          role: 'assistant',
          kind: 'tool_call',
          replay: true,
          content,
          text: null,
          toolCalls: toolUses.map((t) => ({ name: t.name, input: redactForLog(t.name, t.input) })),
          model: res.model,
          stopReason: stop(res.stop_reason),
          ...u,
        });
        pendingUsage = ZERO_USAGE;
        // Every tool_use gets exactly one tool_result, all in one user
        // message, matched by tool_use_id.
        const results: Array<Extract<ContentBlockParam, { type: 'tool_result' }>> = [];
        const summaries: Array<{ name: string; ok: boolean; summary: string }> = [];
        for (let i = 0; i < toolUses.length; i++) {
          const t = toolUses[i];
          if (i >= LIMITS.maxToolCallsPerResponse) {
            results.push({ type: 'tool_result', tool_use_id: t.id, content: '{"ok":false,"error":"too_many_calls_in_one_step"}', is_error: true });
            summaries.push({ name: t.name, ok: false, summary: `${t.name}: skipped (too many calls in one step)` });
            continue;
          }
          const r = await deps.executeTool(t.name, t.input, ctx);
          results.push({ type: 'tool_result', tool_use_id: t.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
          summaries.push({ name: t.name, ok: !r.isError, summary: r.summary });
        }
        messages.push({ role: 'user', content: results });
        rows.push({
          role: 'user',
          kind: 'tool_result',
          replay: true,
          content: results,
          text: summaries.map((s) => s.summary).join(' | ').slice(0, 2000),
          toolCalls: summaries,
        });
        rounds++;
        continue;
      }

      const text = extractReplyText(content);
      if (!text) throw new TurnFailure('empty reply');

      const findings = checkReply(text, messages);
      if (findings && !guardUsed) {
        guardUsed = true;
        rows.push({ role: 'assistant', kind: 'reply', replay: true, content, text, model: res.model, stopReason: 'guard_rejected', ...u });
        pendingUsage = ZERO_USAGE;
        const note = guardNote(findings);
        const noteContent: ContentBlockParam[] = [{ type: 'text', text: note }];
        messages.push({ role: 'user', content: noteContent });
        rows.push({ role: 'user', kind: 'guard', replay: true, content: noteContent, text: note });
        continue; // rounds unchanged: if the budget is spent the next call is text-only
      }
      if (findings) {
        forget();
        rows.push({ role: 'assistant', kind: 'reply', replay: false, content, text, model: res.model, stopReason: 'guard_rejected', ...u });
        const discountish = findings.discount || findings.percents.length > 0;
        return {
          status: 'price_fallback',
          reply: discountish ? MSG.discountFallback : MSG.priceFallback,
          rows,
          handoff: buildHandoff(),
          leadSaved: ctx.leadSavedThisTurn,
          bindingDrops,
          bindingNote,
        };
      }

      rows.push({ role: 'assistant', kind: 'reply', replay: true, content, text, model: res.model, stopReason: stop(res.stop_reason), ...u });
      return { status: 'ok', reply: text, rows, handoff: ctx.handoff, leadSaved: ctx.leadSavedThisTurn, bindingDrops, bindingNote };
    }
  } catch (e) {
    const c = classifyTurnError(e);
    forget();
    const reply = ctx.leadSavedThisTurn ? MSG.errorAfterLead : MSG[c.code];
    rows.push({
      role: 'assistant',
      kind: 'reply',
      replay: false,
      content: [],
      text: reply,
      stopReason: `error:${c.code}`,
      ...pendingUsage,
    });
    return {
      status: 'error',
      code: c.code,
      keyStatus: c.keyStatus,
      closeSession: c.closeSession,
      errorLog: c.log,
      reply,
      rows,
      handoff: buildHandoff(),
      leadSaved: ctx.leadSavedThisTurn,
      bindingDrops,
      bindingNote,
    };
  }
}
