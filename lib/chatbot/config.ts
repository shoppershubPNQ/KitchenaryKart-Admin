/**
 * The website chatbot's settings rows (`settings` table, keys `chatbot_*`) and
 * the encrypted Anthropic API key.
 *
 * KEY HANDLING
 *  - Stored ONLY as `encryptJson({ apiKey })` (AES-256-GCM, lib/crypto.ts; the
 *    encryption key comes from the environment, never the database).
 *  - The plaintext leaves this module only through getDecryptedApiKey(), whose
 *    callers pass it straight to the SDK (lib/chatbot/claude.ts). It is never
 *    logged, returned to a browser, or put in an error string.
 *  - The admin UI only ever sees the masked hint "sk-ant-…ab12".
 *  - /api/settings hides and refuses every chatbot_ row (CHATBOT_SETTING_PREFIX).
 *
 * Settings rows need no migration: they are upserted lazily and the code
 * defaults (lib/chatbot/models.ts) apply until a row exists.
 */
import { prisma } from '../db';
import { decryptJson, encryptJson } from '../crypto';
import {
  CHATBOT_SETTING_PREFIX,
  DEFAULTS,
  SETTING_RANGES,
  isChatModel,
  type ChatModel,
  type KeyState,
  type KeyStatus,
} from './models';
import { scrubSecrets } from './claude';

export const KEYS = {
  apiKeyEnc: 'chatbot_api_key_enc',
  apiKeyHint: 'chatbot_api_key_hint',
  apiKeySetAt: 'chatbot_api_key_set_at',
  apiKeySetBy: 'chatbot_api_key_set_by',
  apiKeyStatus: 'chatbot_api_key_status',
  apiKeyCheckedAt: 'chatbot_api_key_checked_at',
  apiKeyLastError: 'chatbot_api_key_last_error',
  enabled: 'chatbot_enabled',
  model: 'chatbot_model',
  dailyCap: 'chatbot_daily_cap',
  sessionCap: 'chatbot_session_cap',
  ipLimit: 'chatbot_ip_limit',
  dailyCostCapUsd: 'chatbot_daily_cost_cap_usd',
  greeting: 'chatbot_greeting',
} as const;

/** The seven key rows `clear` deletes. */
const API_KEY_ROWS = [
  KEYS.apiKeyEnc,
  KEYS.apiKeyHint,
  KEYS.apiKeySetAt,
  KEYS.apiKeySetBy,
  KEYS.apiKeyStatus,
  KEYS.apiKeyCheckedAt,
  KEYS.apiKeyLastError,
];

const KEY_STATUSES: readonly KeyStatus[] = ['unverified', 'ok', 'invalid', 'billing', 'error'];

/** Format check for `set` (the value itself is never echoed back). */
export const ANTHROPIC_KEY_RE = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;

/** "sk-ant-…ab12" - the only form of the key that ever leaves the server.
 *  Same shape as lib/sync-connection.ts's masked key, but 7 chars so it ends
 *  at "sk-ant-". */
export function maskAnthropicKey(key: string): string {
  const k = key.trim();
  if (k.length < 16) return '••••';
  return `${k.slice(0, 7)}…${k.slice(-4)}`;
}

export interface ChatbotSettings {
  enabled: boolean;
  model: ChatModel;
  dailyCap: number;
  sessionCap: number;
  ipLimit: number;
  dailyCostCapUsd: number;
  greeting: string;
}

export interface ChatbotConfig extends ChatbotSettings {
  keyState: KeyState;
  keyHint: string | null;
  keyStatus: KeyStatus | null;
  keySetAt: string | null;
  keySetBy: string | null;
  keyCheckedAt: string | null;
  keyLastError: string | null;
}

function intIn(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
function numIn(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}
const nonBlank = (v: string | null | undefined) => (v && v.trim() ? v : null);

/** One query for every chatbot_ row. Never returns the plaintext key - the
 *  blob is decrypted only to tell "present" from "unreadable". */
export async function loadChatbotConfig(): Promise<ChatbotConfig> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: CHATBOT_SETTING_PREFIX } } });
  const m = new Map(rows.map((r) => [r.key, r.value ?? '']));
  const get = (k: string) => m.get(k);

  const enc = get(KEYS.apiKeyEnc);
  let keyState: KeyState = 'none';
  if (enc) {
    const dec = decryptJson<{ apiKey?: unknown }>(enc);
    keyState = dec && typeof dec.apiKey === 'string' && dec.apiKey ? 'present' : 'unreadable';
  }
  const status = get(KEYS.apiKeyStatus);
  const model = get(KEYS.model);
  const greeting = nonBlank(get(KEYS.greeting));

  return {
    enabled: get(KEYS.enabled) === 'true',
    model: isChatModel(model) ? model : DEFAULTS.model,
    dailyCap: intIn(get(KEYS.dailyCap), SETTING_RANGES.dailyCap.min, SETTING_RANGES.dailyCap.max, DEFAULTS.dailyCap),
    sessionCap: intIn(get(KEYS.sessionCap), SETTING_RANGES.sessionCap.min, SETTING_RANGES.sessionCap.max, DEFAULTS.sessionCap),
    ipLimit: intIn(get(KEYS.ipLimit), SETTING_RANGES.ipLimit.min, SETTING_RANGES.ipLimit.max, DEFAULTS.ipLimit),
    dailyCostCapUsd: numIn(
      get(KEYS.dailyCostCapUsd),
      SETTING_RANGES.dailyCostCapUsd.min,
      SETTING_RANGES.dailyCostCapUsd.max,
      DEFAULTS.dailyCostCapUsd,
    ),
    greeting: greeting ? greeting.slice(0, SETTING_RANGES.greetingMaxChars) : DEFAULTS.greeting,
    keyState,
    keyHint: keyState === 'none' ? null : nonBlank(get(KEYS.apiKeyHint)),
    keyStatus: keyState === 'none' ? null : KEY_STATUSES.includes(status as KeyStatus) ? (status as KeyStatus) : 'unverified',
    keySetAt: nonBlank(get(KEYS.apiKeySetAt)),
    keySetBy: nonBlank(get(KEYS.apiKeySetBy)),
    keyCheckedAt: nonBlank(get(KEYS.apiKeyCheckedAt)),
    keyLastError: nonBlank(get(KEYS.apiKeyLastError)),
  };
}

/** The plaintext key, or null (none saved / cannot decrypt). Only for passing
 *  straight to makeClaudeClient / testKey - never log or return it. */
export async function getDecryptedApiKey(): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: KEYS.apiKeyEnc } });
  const dec = decryptJson<{ apiKey?: unknown }>(row?.value);
  return dec && typeof dec.apiKey === 'string' && dec.apiKey ? dec.apiKey : null;
}

const upsert = (key: string, value: string, dataType = 'string') =>
  prisma.setting.upsert({ where: { key }, update: { value, dataType }, create: { key, value, dataType } });

/** Save (or replace) the key: encrypted blob + masked hint + who/when, status
 *  back to unverified, last error cleared. The caller runs testKey next. */
export async function setApiKey(apiKey: string, adminEmail: string): Promise<void> {
  const key = apiKey.trim();
  const enc = encryptJson({ apiKey: key }); // throws only when encryption is unavailable (checked by the route first)
  await prisma.$transaction([
    upsert(KEYS.apiKeyEnc, enc, 'secret'),
    upsert(KEYS.apiKeyHint, maskAnthropicKey(key)),
    upsert(KEYS.apiKeySetAt, new Date().toISOString()),
    upsert(KEYS.apiKeySetBy, adminEmail.slice(0, 200)),
    upsert(KEYS.apiKeyStatus, 'unverified'),
    prisma.setting.deleteMany({ where: { key: { in: [KEYS.apiKeyLastError, KEYS.apiKeyCheckedAt] } } }),
  ]);
}

/** Delete the seven key rows and switch the chatbot off. */
export async function clearApiKey(): Promise<void> {
  await prisma.$transaction([
    prisma.setting.deleteMany({ where: { key: { in: API_KEY_ROWS } } }),
    upsert(KEYS.enabled, 'false', 'boolean'),
  ]);
}

/** Record a Test result or a live failure (401/403/402). */
export async function setKeyStatus(status: KeyStatus, error: string | null): Promise<void> {
  const status_ = upsert(KEYS.apiKeyStatus, status);
  const checked = upsert(KEYS.apiKeyCheckedAt, new Date().toISOString());
  if (error) {
    await prisma.$transaction([status_, checked, upsert(KEYS.apiKeyLastError, scrubSecrets(error).slice(0, 300))]);
  } else {
    await prisma.$transaction([status_, checked, prisma.setting.deleteMany({ where: { key: KEYS.apiKeyLastError } })]);
  }
}

/** Upsert the admin-editable settings that are present in `partial`. */
export async function saveSettings(partial: Partial<ChatbotSettings>): Promise<void> {
  const ops = [];
  if (partial.enabled !== undefined) ops.push(upsert(KEYS.enabled, partial.enabled ? 'true' : 'false', 'boolean'));
  if (partial.model !== undefined) ops.push(upsert(KEYS.model, partial.model));
  if (partial.dailyCap !== undefined) ops.push(upsert(KEYS.dailyCap, String(partial.dailyCap), 'number'));
  if (partial.sessionCap !== undefined) ops.push(upsert(KEYS.sessionCap, String(partial.sessionCap), 'number'));
  if (partial.ipLimit !== undefined) ops.push(upsert(KEYS.ipLimit, String(partial.ipLimit), 'number'));
  if (partial.dailyCostCapUsd !== undefined) ops.push(upsert(KEYS.dailyCostCapUsd, String(partial.dailyCostCapUsd), 'number'));
  if (partial.greeting !== undefined) ops.push(upsert(KEYS.greeting, partial.greeting));
  if (ops.length) await prisma.$transaction(ops);
}

/** What the public widget may know: on/off and the greeting - never the
 *  model, caps or anything about the key. */
export function publicChatEnabled(cfg: ChatbotConfig): boolean {
  return cfg.enabled && cfg.keyState === 'present' && cfg.keyStatus !== 'invalid' && cfg.keyStatus !== 'billing';
}
