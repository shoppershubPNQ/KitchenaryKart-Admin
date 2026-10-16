/**
 * Approximate USD cost of a chatbot reply, for the admin Usage card and the
 * owner's daily spend cap. Labelled "approx." in the UI because published
 * prices can change.
 *
 * Rates are USD per million tokens, from the bundled Claude API reference
 * (shared/model-migration.md: Haiku 5.5 intro, Sonnet 5.5 intro, Opus 5.5
 * "What carries over"; Fable 5.1 "Coming from Claude Opus 5" for the
 * server-side fallback targets). 5-minute cache writes are 1.25x input.
 */
import type Anthropic from '@anthropic-ai/sdk';

type Rate = { in: number; out: number; cacheRead: number; cacheWrite5m: number };

const RATES: Record<string, Rate> = {
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite5m: 0.125 }, // prompt <= 100K tokens
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2, cacheWrite5m: 2.5 },
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2, cacheWrite5m: 5 },
  // Server-side fallback targets that can serve a Sonnet / Opus 5.5 request
  // (Opus 5.5 declines go to Claude Opus 5 / claude-opus-4-8; cyber declines
  // to Opus 4.8 - model-migration.md -> Opus 5.5 safeguards, Opus 5 "New API
  // features"). Opus 4.8 is priced as Opus 5 ($5 / $25, "a drop-in upgrade at
  // Opus 4.8's pricing"), cache read 0.1x, 5-minute write 1.25x.
  'claude-sonnet-5': { in: 2, out: 10, cacheRead: 0.2, cacheWrite5m: 2.5 },
  'claude-opus-5': { in: 5, out: 25, cacheRead: 0.5, cacheWrite5m: 6.25 },
  'claude-opus-4-8': { in: 5, out: 25, cacheRead: 0.5, cacheWrite5m: 6.25 },
};
/** Claude Haiku 5.5's second rate card, for prompts over 100K tokens. */
const HAIKU_LONG: Rate = { in: 0.5, out: 2.5, cacheRead: 0.05, cacheWrite5m: 0.625 };
/** Any model id not in RATES is priced at the highest known tier (Claude Fable
 *  5.1, $10 / $50; cache read rounded UP to 0.1x) - for a spend cap,
 *  over-counting is the safe direction. */
const UNKNOWN_MODEL_RATE: Rate = { in: 10, out: 50, cacheRead: 1, cacheWrite5m: 12.5 };
const warnedUnknown = new Set<string>();

// Longest id first, so "claude-sonnet-5-5" is never priced as "claude-sonnet-5".
const RATE_KEYS = Object.keys(RATES).sort((a, b) => b.length - a.length);

function rateFor(model: string | null | undefined): Rate | null {
  if (!model) return null;
  const k = RATE_KEYS.find((key) => model.startsWith(key));
  return k ? RATES[k] : null;
}

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** `requestedModel` prices a usage entry that names no model at all. */
export function costUsd(model: string, requestedModel: string, u: TokenCounts): number {
  const id = model || requestedModel;
  const prompt = u.input + u.cacheRead + u.cacheWrite;
  let rate: Rate;
  if (id.startsWith('claude-haiku-5-5') && prompt > 100_000) {
    rate = HAIKU_LONG;
  } else {
    const known = rateFor(id);
    if (!known && !warnedUnknown.has(id)) {
      warnedUnknown.add(id);
      console.warn(`[chatbot] no price for model "${String(id).slice(0, 60)}" - counted at the highest known rate`);
    }
    rate = known ?? UNKNOWN_MODEL_RATE;
  }
  return (u.input * rate.in + u.output * rate.out + u.cacheRead * rate.cacheRead + u.cacheWrite * rate.cacheWrite5m) / 1e6;
}

/** Usage of one API response, in the shape a chat_messages row stores. */
export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export const ZERO_USAGE: TurnUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };

export function addUsage(a: TurnUsage, b: TurnUsage): TurnUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Tokens and cost of one response. When a server-side fallback ran,
 * `usage.iterations` is the per-attempt source of truth and top-level `usage`
 * covers only the attempt that produced the message, so the iterations are
 * summed, each priced by its own model. A declined attempt is a plain
 * `message` entry and the serving one a `fallback_message` entry
 * (model-migration.md -> server-side fallback, "Reading the response"), so a
 * `message` entry without a model, in a response that fell back, is the
 * REQUESTED model's attempt - top-level `model` names the fallback model.
 */
export function usageOf(res: Anthropic.Beta.BetaMessage, requestedModel: string): TurnUsage {
  const usage = res.usage;
  const iterations = (usage as { iterations?: unknown } | null)?.iterations;
  if (Array.isArray(iterations) && iterations.length > 0) {
    const its = iterations as Array<Record<string, unknown>>;
    const fellBack = its.some((x) => x.type === 'fallback_message');
    let total = ZERO_USAGE;
    for (const it of its) {
      const c: TokenCounts = {
        input: n(it.input_tokens),
        output: n(it.output_tokens),
        cacheRead: n(it.cache_read_input_tokens),
        cacheWrite: n(it.cache_creation_input_tokens),
      };
      const model =
        typeof it.model === 'string' && it.model
          ? it.model
          : it.type === 'message' && fellBack
            ? requestedModel
            : res.model || requestedModel;
      total = addUsage(total, {
        inputTokens: c.input,
        outputTokens: c.output,
        cacheReadTokens: c.cacheRead,
        cacheWriteTokens: c.cacheWrite,
        costUsd: costUsd(model, requestedModel, c),
      });
    }
    return total;
  }
  const c: TokenCounts = {
    input: n(usage?.input_tokens),
    output: n(usage?.output_tokens),
    cacheRead: n(usage?.cache_read_input_tokens),
    cacheWrite: n(usage?.cache_creation_input_tokens),
  };
  return {
    inputTokens: c.input,
    outputTokens: c.output,
    cacheReadTokens: c.cacheRead,
    cacheWriteTokens: c.cacheWrite,
    costUsd: costUsd(res.model || requestedModel, requestedModel, c),
  };
}
