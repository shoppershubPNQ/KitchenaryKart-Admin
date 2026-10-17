/**
 * Website chatbot: model ids, labels, defaults and fixed limits.
 *
 * NO IMPORTS on purpose - the admin Chatbot page ('use client') imports this
 * file, so it must never pull the SDK, Prisma or node:crypto into the browser.
 *
 * Model ids are exact, from the bundled Claude API reference
 * (shared/models.md -> Current Models).
 */

/** Every `settings` row the chatbot owns starts with this. /api/settings hides
 *  and refuses them (app/api/settings/route.ts) - they are edited only on
 *  Dashboard -> Chatbot. */
export const CHATBOT_SETTING_PREFIX = 'chatbot_';

export const CHAT_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'] as const;
export type ChatModel = (typeof CHAT_MODELS)[number];
export const DEFAULT_CHAT_MODEL: ChatModel = 'claude-haiku-5-5';
export const isChatModel = (v: unknown): v is ChatModel =>
  typeof v === 'string' && (CHAT_MODELS as readonly string[]).includes(v);

export const MODEL_LABELS: Record<ChatModel, { label: string; note: string }> = {
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5 (default)', note: 'Cheapest and fastest (recommended).' },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', note: 'Stronger reasoning, slower. About 20x the cost of Haiku.' },
  'claude-opus-5-5': { label: 'Claude Opus 5.5', note: 'Most capable, slowest. About 40x the cost of Haiku.' },
};

/** Fixed limits (not admin-editable). The editable caps live in settings. */
export const LIMITS = {
  maxMessageChars: 1000,
  maxToolRounds: 4,
  maxToolCallsPerResponse: 4,
  ipWindowSec: 600,
  globalPerMinute: 40,
  /** Replies being generated at the same moment, whole website. */
  maxInFlight: 15,
  maxLeadsPerSession: 1,
  /** save_lead: per visitor network per day, and whole website per day. */
  maxLeadsPerIpPerDay: 3,
  maxLeadsPerDay: 40,
  maxOrderLookupsPerSession: 5,
  /** track_order: attempts per order number per day, per visitor network per hour. */
  maxLookupsPerOrderPerDay: 6,
  maxLookupsPerIpPerHour: 10,
  sessionIdleHours: 12,
  turnBudgetMs: 52_000,
  /** Customer photos: one per message (the request shape); at most this many
   *  ANSWERED photos per chat (replayed customer rows - a photo whose turn
   *  failed does not use one up); and photo requests that reach Claude per
   *  visitor network per hour and per IST day for the whole website (these two
   *  bound retries and abuse, and the database growth: each photo is kept with
   *  its chat, about 0.4 MB, and nothing deletes chat rows yet). A photo message
   *  also counts as one message in every message cap, and its image tokens in
   *  the daily spend cap. */
  maxPhotosPerChat: 2,
  maxPhotosPerIpPerHour: 4,
  maxPhotosPerDay: 40,
} as const;

/** Cost reserved per in-flight reply when checking the daily spend cap
 *  (USD; a typical turn costs well below this). A single turn that runs past
 *  TURN_COST_CEILING_FACTOR x this is cut short (lib/chatbot/turn.ts).
 *  A customer photo is re-sent on every call of the chat, mostly as a cache
 *  read. The server enforces its size (photo.ts: long side <= 1100 px and at
 *  most 1024 x 1024 pixels), so a photo is at most about ceil(w/28) x
 *  ceil(h/28) = ~1,400 image tokens (the widget's 1024 px photos: 1,000-1,400):
 *  well under $0.001 per call on Haiku 5.5 and about $0.003 / $0.006 on
 *  Sonnet / Opus 5.5 uncached, so these reserves need no change. The real
 *  cost is always taken from the response's usage (pricing.ts). */
export const TURN_COST_RESERVE_USD: Record<ChatModel, number> = {
  'claude-haiku-5-5': 0.02,
  'claude-sonnet-5-5': 0.4,
  'claude-opus-5-5': 0.8,
};
export const TURN_COST_CEILING_FACTOR = 3;

export const DEFAULTS = {
  enabled: false,
  model: DEFAULT_CHAT_MODEL,
  dailyCap: 300,
  sessionCap: 30,
  ipLimit: 20,
  dailyCostCapUsd: 5,
  greeting:
    "Namaste! I'm Kitchenary Kart's virtual sales assistant (an AI). Ask me about products, prices, stock or your order - in Hindi, English or Hinglish.",
} as const;

/** Ranges the admin PUT accepts (also used to clamp stored values on read). */
export const SETTING_RANGES = {
  dailyCap: { min: 1, max: 5000 },
  sessionCap: { min: 5, max: 100 },
  ipLimit: { min: 1, max: 200 }, // the per-visitor limit is mandatory - never 0
  dailyCostCapUsd: { min: 0.5, max: 500 },
  greetingMaxChars: 300,
} as const;

/** Owner-facing names of the editable settings (admin errors + page labels). */
export const SETTING_LABELS = {
  dailyCap: 'Daily message cap',
  sessionCap: 'Messages per chat',
  ipLimit: 'Messages per visitor per 10 minutes',
  dailyCostCapUsd: 'Daily spend cap (USD)',
  greeting: 'Greeting',
  model: 'Model',
  enabled: 'Chatbot on/off',
} as const;

export type KeyStatus = 'unverified' | 'ok' | 'invalid' | 'billing' | 'error';
export type KeyState = 'none' | 'present' | 'unreadable';
