/**
 * The website chatbot's Claude calls - SERVER ONLY (node:crypto + the SDK).
 * Import only from route handlers / lib, never from a 'use client' file.
 *
 * Every model and parameter decision here comes from the bundled Claude API
 * reference (claude-api/shared/*.md, typescript/claude-api/*.md):
 *  - Claude is called ONLY through the official @anthropic-ai/sdk, on
 *    `client.beta.messages.create` for all three models so requests and
 *    responses use the beta types throughout (typescript tool-use.md: "Don't
 *    mix beta and non-beta types").
 *  - No temperature / top_p / top_k (400 on Haiku 5.5), no assistant prefill
 *    (messages always end with a user turn), tool_choice only auto / none
 *    (forced choice is a 400 on Sonnet / Opus 5.5 and skips thinking on Haiku).
 *  - Adaptive thinking (always on for Opus 5.5; budget_tokens is a 400) with
 *    block_binding drop_block (every input_transformations entry is logged by
 *    turn.ts), effort fixed per model (EFFORT).
 *  - Server-side fallback ("default" scalar form + its own beta header) only
 *    for Sonnet / Opus 5.5 - never for Haiku 5.5, which has none.
 *  - The frozen system prompt + tools carry the cache breakpoint.
 *
 * The API key is passed in explicitly (decrypted per request by the caller),
 * never logged, never put in an error string - see scrubSecrets().
 */
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { SYSTEM_PROMPT } from './prompt';
import { TOOLS } from './tools';
import type { ChatModel } from './models';
import type { ErrorCode } from './messages';

export type MsgParam = Anthropic.Beta.BetaMessageParam;
export type ContentBlock = Anthropic.Beta.BetaContentBlock;
export type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
export type BetaMessage = Anthropic.Beta.BetaMessage;
export type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** Fixed per model: a chat stays on the model it started with (store.ts), so
 *  its effort never changes mid-chat and never invalidates the messages cache
 *  (prompt-caching.md -> Invalidation hierarchy). Haiku 5.5 runs at its
 *  default `medium`: at `low`, with a long prompt, it is more likely to skip a
 *  search (model-migration.md -> Haiku 5.5 effort levels / Behavioral shifts),
 *  and this bot must call search_products before every product, price or
 *  stock claim - the price guard in turn.ts only backstops rupee amounts.
 *  Sonnet / Opus 5.5 stay at `low` for chat. The admin Test warm-up uses the
 *  same value, so warm-up and live traffic share one cache. */
export const EFFORT: Record<ChatModel, 'low' | 'medium'> = {
  'claude-haiku-5-5': 'medium',
  'claude-sonnet-5-5': 'low',
  'claude-opus-5-5': 'low',
};
/** Thinking counts toward max_tokens (Haiku 5.5 -> Thinking is on by default). */
export const MAX_TOKENS = 4096;
/** One retry when a reply stops on max_tokens with no text. */
export const MAX_TOKENS_RETRY = 8192;
/** SDK default is 10 minutes; the TS option is in milliseconds. */
const CALL_TIMEOUT_MS = 25_000;
/** The SDK auto-retries connection errors, 408, 409, 429 and >= 500. */
const MAX_RETRIES = 1;

/** Preserved-thinking controls (Opus 5.5 / Sonnet 5.5 / Haiku 5.5 -> "thinking
 *  blocks are tied to the model and the conversation"). */
const BETA_BINDING = 'thinking-binding-controls-2026-08-01';
/** For the `fallbacks: "default"` SCALAR form only - the array form needs
 *  -2026-06-01, and pairing a header with the other form is a 400. */
const BETA_FALLBACK_DEFAULT = 'server-side-fallback-2026-07-01';
/** Switch off only if the admin Test (testKey step 2) returns 400 naming
 *  block_binding / the binding beta. */
export const USE_BINDING_CONTROLS = true;
/** Sonnet 5.5 / Opus 5.5 only. Switch off only if the Test returns 400 naming
 *  fallbacks. */
export const USE_SERVER_FALLBACK = true;

export function makeClaudeClient(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey, // explicit, decrypted per request, never logged
    authToken: null, // never also send ANTHROPIC_AUTH_TOKEN: both auth headers => 401
    timeout: CALL_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
  });
}

// Frozen: system + tools are byte-identical on every request. The breakpoint
// on the last system block caches tools + system together (render order is
// tools -> system -> messages).
const SYSTEM: Anthropic.Beta.BetaTextBlockParam[] = [
  { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
];

/** Hash of the prompt + tools. A chat started under another version is not
 *  replayed (its thinking blocks would no longer match the prefix) - a new
 *  session starts instead. */
export const PROMPT_VERSION = createHash('sha256').update(JSON.stringify({ SYSTEM_PROMPT, TOOLS })).digest('hex').slice(0, 16);

export function buildParams(
  model: ChatModel,
  messages: MsgParam[],
  o: { maxTokens: number; noMoreTools: boolean; warmup?: boolean },
): CreateParams {
  const fallback = USE_SERVER_FALLBACK && model !== 'claude-haiku-5-5'; // Haiku 5.5: NEVER send fallbacks
  const betas: Anthropic.Beta.AnthropicBeta[] = [
    ...(USE_BINDING_CONTROLS ? [BETA_BINDING] : []),
    ...(fallback ? [BETA_FALLBACK_DEFAULT] : []),
  ];
  const p: CreateParams = {
    model,
    max_tokens: o.maxTokens,
    system: SYSTEM,
    tools: TOOLS,
    // auto everywhere; "none" for the final text-only call. A tool_choice
    // change keeps the tools + system cache and the thinking blocks valid.
    tool_choice: o.noMoreTools ? { type: 'none' } : { type: 'auto' },
    output_config: { effort: EFFORT[model] },
    messages, // always ends with a user turn; no sampling params; no prefill
  };
  // Omitted == adaptive on all three models; block_binding needs adaptive +
  // the beta header. drop_block makes an accidental history change degrade
  // instead of 400 (accounts created on/after 2026-08-31 are enforced).
  if (USE_BINDING_CONTROLS) {
    p.thinking = { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } };
  }
  // Explicit system breakpoint + top-level automatic caching for the growing
  // tail. Not on warm-up requests: automatic caching would key the cache to
  // the placeholder message (prompt-caching.md -> Pre-warming the cache).
  if (!o.warmup) p.cache_control = { type: 'ephemeral' };
  if (fallback) p.fallbacks = 'default';
  if (betas.length) p.betas = betas;
  return p;
}

/** One Messages call bounded to `timeoutMs` of wall time IN TOTAL: the abort
 *  signal also covers the SDK's own retry and any retry-after wait (which the
 *  SDK honours up to 60 s), so a turn can never outlive the route's budget.
 *  An abort surfaces as APIUserAbortError -> classified as code "error". */
export async function callClaude(client: Anthropic, params: CreateParams, timeoutMs: number): Promise<BetaMessage> {
  const t = Math.max(1000, Math.min(CALL_TIMEOUT_MS, timeoutMs));
  return client.beta.messages.create(params, { timeout: t, signal: AbortSignal.timeout(t) });
}

// ------------------------------------------------------------ helpers

/** Remove anything shaped like an Anthropic key, and cap the length. Every
 *  error string that is stored or returned goes through this. */
export const scrubSecrets = (s: string) => String(s ?? '').replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-…').slice(0, 500);

/**
 * Echo assistant content back unchanged (tool-use.md: append the full
 * response.content), except server-side fallback artefacts: drop thinking /
 * redacted_thinking / tool_use / server_tool_use blocks that appear BEFORE the
 * last `fallback` block, and the `fallback` marker itself ("an ignored audit
 * marker (keep or drop)" - model-migration.md -> refusal stop reason ->
 * Echoing fallback turns back). Non-streaming responses omit a declined
 * partial, so normally nothing precedes the marker.
 */
export function sanitizeAssistantContent(blocks: ContentBlock[]): ContentBlockParam[] {
  const types = blocks.map((b) => (b as { type: string }).type);
  const lastFallback = types.lastIndexOf('fallback');
  const drop = new Set(['thinking', 'redacted_thinking', 'tool_use', 'server_tool_use']);
  return blocks.filter(
    (_b, i) => types[i] !== 'fallback' && !(i < lastFallback && drop.has(types[i])),
  ) as unknown as ContentBlockParam[];
}

/** Read text blocks by type, never content[0] - a response can begin with
 *  thinking blocks. Markdown bold / headings are stripped for the chat bubble. */
export function extractReplyText(blocks: ContentBlockParam[]): string {
  return blocks
    .filter((b) => (b as { type: string }).type === 'text')
    .map((b) => String((b as { text?: unknown }).text ?? ''))
    .join('\n\n')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim()
    .slice(0, 4000);
}

export function hasText(blocks: ContentBlockParam[]): boolean {
  return blocks.some((b) => (b as { type: string }).type === 'text' && String((b as { text?: unknown }).text ?? '').trim() !== '');
}

/** Typed check (never string matching) for the replayed-history recovery in turn.ts. */
export const isBadRequest = (e: unknown): boolean => e instanceof Anthropic.BadRequestError;

/**
 * The documented one-time recovery for a 400 on a replayed history (e.g. a
 * thinking signature that no longer verifies): the same messages with every
 * `thinking` / `redacted_thinking` block removed from every assistant turn;
 * text and tool_use blocks stay (model-migration.md -> Fable 5.1 from Fable 5
 * -> Breaking change 3, recovery 1). Returns NEW message objects - the stored
 * rows are not touched.
 */
export function stripThinking(messages: MsgParam[]): MsgParam[] {
  return messages.map((m) =>
    m.role === 'assistant' && Array.isArray(m.content)
      ? {
          ...m,
          content: m.content.filter((b) => {
            const t = (b as { type: string }).type;
            return t !== 'thinking' && t !== 'redacted_thinking';
          }),
        }
      : m,
  );
}

// ------------------------------------------------------- key test

/** Per call of the admin Test (two calls, so well inside the route's 60 s). */
const KEY_TEST_TIMEOUT_MS = 20_000;

export type KeyTestStatus = 'ok' | 'invalid' | 'billing' | 'error';

/** A Test result. `photos` (only with status ok): whether the model accepts
 *  image input, from the Models API (shared/models.md -> capabilities
 *  image_input.supported); false switches the chat's camera off. */
export interface KeyTestResult {
  status: KeyTestStatus;
  detail: string;
  photos?: boolean;
}

/** Typed SDK exceptions, most specific first; never string-matched
 *  (typescript README -> Error Handling; error-codes.md -> Typed Exceptions).
 *  APIConnectionError is checked before the APIError fallbacks because in the
 *  TS SDK it is a subclass of APIError. */
export function classifyKeyError(e: unknown, model: string): { status: KeyTestStatus; detail: string } {
  const out = (status: KeyTestStatus, detail: string) => ({ status, detail: scrubSecrets(detail).slice(0, 300) });
  if (e instanceof Anthropic.AuthenticationError) return out('invalid', 'The key was rejected (401). Check that the whole key was copied.');
  if (e instanceof Anthropic.PermissionDeniedError) return out('invalid', 'This key is not allowed to use the API (403).');
  if (e instanceof Anthropic.NotFoundError) return out('error', `Model ${model} is not available to this key (404). Choose another model.`);
  if (e instanceof Anthropic.RateLimitError) return out('error', 'Rate limited by Anthropic (429) - try again in a minute.');
  if (e instanceof Anthropic.BadRequestError) return out('error', `Request rejected (400): ${scrubSecrets(e.message).slice(0, 200)}`);
  if (e instanceof Anthropic.InternalServerError) return out('error', `Anthropic is having trouble (${e.status}). Try again later.`);
  if (e instanceof Anthropic.APIConnectionError) return out('error', 'Could not reach api.anthropic.com.');
  if (e instanceof Anthropic.APIError && e.status === 402) {
    return out('billing', 'Billing problem on the Anthropic account (402) - add credits in the Anthropic Console, then Test again.');
  }
  if (e instanceof Anthropic.APIError) return out('error', `Unexpected error (${e.status ?? 'no status'}).`);
  return out('error', 'Unexpected error.');
}

/**
 * Used by the admin key `set` / `test` actions and on a model change. Two calls:
 *  1. models.retrieve - free; the key works and this model is available to it.
 *     Its capabilities also say whether the model accepts photos (`photos`).
 *  2. A production-shaped warm-up with max_tokens 0: prefill only (no output
 *     billed), validates the exact betas / thinking / fallbacks / strict tool
 *     schemas production sends, and primes the system + tools cache.
 */
export async function testKey(apiKey: string, model: ChatModel): Promise<KeyTestResult> {
  const client = makeClaudeClient(apiKey);
  try {
    const info = await client.models.retrieve(model, {}, { timeout: KEY_TEST_TIMEOUT_MS, signal: AbortSignal.timeout(KEY_TEST_TIMEOUT_MS) });
    // capabilities is null only for an unknown model record: assume photos work
    // (a photo the model cannot read is then answered as photo_invalid, turn.ts).
    const photos = info.capabilities ? info.capabilities.image_input.supported === true : true;
    // A 200 is the result; its usage is not shown to the owner.
    await client.beta.messages.create(
      buildParams(model, [{ role: 'user', content: [{ type: 'text', text: 'warmup' }] }], {
        maxTokens: 0,
        noMoreTools: false,
        warmup: true,
      }),
      { timeout: KEY_TEST_TIMEOUT_MS, signal: AbortSignal.timeout(KEY_TEST_TIMEOUT_MS) },
    );
    return {
      status: 'ok',
      detail: photos
        ? 'Key works - the chatbot can use it.'
        : 'Key works, but this model does not accept photos - the chat camera stays off.',
      photos,
    };
  } catch (e) {
    return classifyKeyError(e, model);
  }
}

// --------------------------------------------------- turn errors

export class TurnTimeout extends Error {
  constructor() {
    super('turn deadline exceeded');
    this.name = 'TurnTimeout';
  }
}
export class TurnFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TurnFailure';
  }
}
/** Claude refused (400) the first request of a turn that carries the
 *  customer's photo - thrown by turn.ts, answered as photo_invalid. */
export class PhotoRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoRejected';
  }
}

export interface TurnErrorClass {
  code: ErrorCode;
  keyStatus?: 'invalid' | 'billing';
  closeSession?: boolean;
  log: string;
}

/** Public-route classification of anything a turn throws. */
export function classifyTurnError(e: unknown): TurnErrorClass {
  const status = e instanceof Anthropic.APIError ? e.status : undefined;
  const msg = e instanceof Error ? e.message : String(e);
  const log = scrubSecrets(`${e instanceof Error ? e.name : 'Error'}${status ? ` ${status}` : ''}: ${msg}`);

  // A turn with a photo whose first request Claude rejected (turn.ts decides,
  // after the replayed-history retry where there is a history): only this
  // photo failed - the chat stays open and the customer sees photo_invalid.
  if (e instanceof PhotoRejected) return { code: 'photo_invalid', log };
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return { code: 'unavailable', keyStatus: 'invalid', log };
  }
  // The chat's pinned model is not available to this key: close the chat so
  // the next message starts a new one on the current admin model.
  if (e instanceof Anthropic.NotFoundError) return { code: 'unavailable', closeSession: true, log };
  if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError) return { code: 'upstream_busy', log };
  if (e instanceof Anthropic.BadRequestError) {
    // Type-based, never string-matched. A turn WITHOUT a new photo: the only
    // variable part of the request is the replayed history, and turn.ts has
    // already retried once without thinking blocks - this chat cannot
    // continue safely, so the next message starts a new one. (A 400 on the
    // first request of a turn WITH a photo arrives here as PhotoRejected
    // instead; a 400 later in such a turn - after Claude accepted the photo -
    // is handled like any other.)
    return { code: 'error', closeSession: true, log };
  }
  if (e instanceof Anthropic.APIConnectionError) return { code: 'error', log };
  if (e instanceof Anthropic.APIError && e.status === 402) return { code: 'unavailable', keyStatus: 'billing', log };
  return { code: 'error', log };
}
