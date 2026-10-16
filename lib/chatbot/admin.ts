/**
 * Admin-side chatbot logic behind app/api/chatbot/** (admin role only - the
 * routes wrap these in withAuth(..., ['admin'])).
 *
 * Nothing here ever returns, logs or echoes the plaintext API key: the status
 * body carries only the masked hint, and the key actions return the key
 * *state* plus a scrubbed test detail.
 */
import { z } from 'zod';
import { encryptionAvailable } from '../crypto';
import { CHAT_MODELS, LIMITS, MODEL_LABELS, SETTING_LABELS, SETTING_RANGES } from './models';
import { chatProxySecret } from './limits';
import {
  ANTHROPIC_KEY_RE,
  clearApiKey,
  getDecryptedApiKey,
  loadChatbotConfig,
  saveSettings,
  setApiKey,
  setKeyStatus,
  type ChatbotConfig,
  type ChatbotSettings,
} from './config';
import { PROMPT_VERSION, scrubSecrets, testKey } from './claude';
import { getSessionTranscript, listSessions, usageSummary, type SessionFilter } from './store';

/** Handler result: a JSON body with a status, or an error message. */
export type AdminResult = { ok: true; body: unknown; status?: number } | { ok: false; error: string; status: number };

function keyObject(cfg: ChatbotConfig) {
  return {
    state: cfg.keyState,
    masked: cfg.keyHint,
    status: cfg.keyStatus,
    setAt: cfg.keySetAt,
    setBy: cfg.keySetBy,
    checkedAt: cfg.keyCheckedAt,
    lastError: cfg.keyLastError,
  };
}

/** GET /api/chatbot body (also returned by PUT). */
export async function chatbotStatus() {
  const cfg = await loadChatbotConfig();
  // The usage tables may not exist yet (migration not applied) - the page
  // must still load so the key can be set up.
  let usage: Awaited<ReturnType<typeof usageSummary>> | null = null;
  let usageError: string | null = null;
  try {
    usage = await usageSummary();
  } catch (e) {
    usageError = 'Usage is unavailable - have the chat tables been created (scripts/create-chatbot-tables.ts)?';
    console.error('[chatbot] usage query failed:', scrubSecrets(e instanceof Error ? e.message : String(e)).slice(0, 200));
  }
  return {
    encryptionAvailable,
    key: keyObject(cfg),
    settings: {
      enabled: cfg.enabled,
      model: cfg.model,
      dailyCap: cfg.dailyCap,
      sessionCap: cfg.sessionCap,
      ipLimit: cfg.ipLimit,
      dailyCostCapUsd: cfg.dailyCostCapUsd,
      greeting: cfg.greeting,
    },
    models: CHAT_MODELS.map((id) => ({ id, label: MODEL_LABELS[id].label, note: MODEL_LABELS[id].note })),
    limits: {
      maxMessageChars: LIMITS.maxMessageChars,
      maxToolRounds: LIMITS.maxToolRounds,
      ipWindowMinutes: LIMITS.ipWindowSec / 60,
      globalPerMinute: LIMITS.globalPerMinute,
      sessionIdleHours: LIMITS.sessionIdleHours,
      maxOrderLookupsPerChat: LIMITS.maxOrderLookupsPerSession,
      maxLeadsPerChat: LIMITS.maxLeadsPerSession,
      /** CHATBOT_PROXY_SECRET is set: the visitor IP is signed by the website. */
      visitorIpSigned: chatProxySecret() !== null,
    },
    usage,
    usageError,
    promptVersion: PROMPT_VERSION,
  };
}

const putSchema = z
  .object({
    enabled: z.boolean().optional(),
    model: z.enum(CHAT_MODELS).optional(),
    dailyCap: z.number().int().min(SETTING_RANGES.dailyCap.min).max(SETTING_RANGES.dailyCap.max).optional(),
    sessionCap: z.number().int().min(SETTING_RANGES.sessionCap.min).max(SETTING_RANGES.sessionCap.max).optional(),
    ipLimit: z.number().int().min(SETTING_RANGES.ipLimit.min).max(SETTING_RANGES.ipLimit.max).optional(),
    dailyCostCapUsd: z.number().min(SETTING_RANGES.dailyCostCapUsd.min).max(SETTING_RANGES.dailyCostCapUsd.max).optional(),
    greeting: z.string().trim().min(1).max(SETTING_RANGES.greetingMaxChars).optional(),
  })
  .strict();

const WHOLE_NUMBER_FIELDS = new Set(['dailyCap', 'sessionCap', 'ipLimit']);

/** Owner-facing wording with the page's labels, e.g. "Messages per chat must
 *  be a whole number between 5 and 100." - never zod's field names. */
function zodMessage(e: z.ZodError): string {
  const lines = e.errors.map((x) => {
    const field = String(x.path[0] ?? '');
    const label = (SETTING_LABELS as Record<string, string>)[field];
    if (!label) return 'Some settings were not recognised - reload the page and try again.';
    const range = (SETTING_RANGES as Record<string, unknown>)[field] as { min: number; max: number } | undefined;
    if (range && typeof range === 'object') {
      return `${label} must be ${WHOLE_NUMBER_FIELDS.has(field) ? 'a whole number' : 'a number'} between ${range.min} and ${range.max}.`;
    }
    if (field === 'greeting') return `${label} must be 1 to ${SETTING_RANGES.greetingMaxChars} characters.`;
    return `${label}: please choose a valid value.`;
  });
  return [...new Set(lines)].join(' ');
}

/** Plain text only: no angle brackets, no control characters. */
const cleanGreeting = (s: string) => s.replace(/[<>]/g, '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s{2,}/g, ' ').trim();

/** PUT /api/chatbot. A model change is tested with the saved key first; the
 *  chatbot can only be switched on with a working (status ok) key. */
export async function updateChatbotSettings(raw: unknown): Promise<AdminResult> {
  const parsed = putSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: zodMessage(parsed.error), status: 400 };
  const b = parsed.data;
  const cfg = await loadChatbotConfig();
  const partial: Partial<ChatbotSettings> = {};
  let modelTested = false;

  if (b.model && b.model !== cfg.model) {
    if (cfg.keyState === 'present') {
      const key = await getDecryptedApiKey();
      if (!key) return { ok: false, error: 'The saved key cannot be decrypted - please re-enter it.', status: 409 };
      const t = await testKey(key, b.model);
      if (t.status !== 'ok') return { ok: false, error: `The key could not use ${b.model}: ${t.detail}`, status: 400 };
      modelTested = true;
    } else if (cfg.keyState === 'unreadable') {
      return { ok: false, error: 'The saved key cannot be decrypted - please re-enter it.', status: 409 };
    }
    // No key yet: saved untested - "Save key" tests the key with this model.
    partial.model = b.model;
  }

  if (b.enabled === true) {
    const statusAfter = modelTested ? 'ok' : cfg.keyStatus;
    if (cfg.keyState !== 'present' || statusAfter !== 'ok') {
      return { ok: false, error: 'Add the API key and run Test successfully before switching the chatbot on.', status: 400 };
    }
    partial.enabled = true;
  } else if (b.enabled === false) {
    partial.enabled = false;
  }

  if (b.dailyCap !== undefined) partial.dailyCap = b.dailyCap;
  if (b.sessionCap !== undefined) partial.sessionCap = b.sessionCap;
  if (b.ipLimit !== undefined) partial.ipLimit = b.ipLimit;
  if (b.dailyCostCapUsd !== undefined) partial.dailyCostCapUsd = b.dailyCostCapUsd;
  if (b.greeting !== undefined) {
    const g = cleanGreeting(b.greeting);
    if (!g) return { ok: false, error: 'Greeting cannot be empty.', status: 400 };
    partial.greeting = g;
  }

  await saveSettings(partial);
  if (modelTested) await setKeyStatus('ok', null);
  return { ok: true, body: await chatbotStatus() };
}

const keySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set'), apiKey: z.string().min(1).max(400) }),
  z.object({ action: z.literal('test') }),
  z.object({ action: z.literal('clear') }),
]);

/** POST /api/chatbot/key {action: set | test | clear}. Never echoes, logs or
 *  returns the key; every error is a fixed message. */
export async function chatbotKeyAction(raw: unknown, adminEmail: string): Promise<AdminResult> {
  const parsed = keySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Invalid request.', status: 400 };
  const b = parsed.data;

  if (b.action === 'clear') {
    await clearApiKey();
    return { ok: true, body: { key: keyObject(await loadChatbotConfig()) } };
  }

  if (b.action === 'set') {
    const key = b.apiKey.trim();
    if (!ANTHROPIC_KEY_RE.test(key)) {
      return { ok: false, error: "That doesn't look like an Anthropic API key (it starts with sk-ant-).", status: 400 };
    }
    if (!encryptionAvailable) {
      return {
        ok: false,
        error: 'Encryption is not configured on the server (JWT_SECRET / INTEGRATION_ENC_KEY). The key was not saved.',
        status: 503,
      };
    }
    // Test BEFORE saving: a wrong or partial key must never replace the key
    // the live chat is using (the bubble would disappear from the website).
    const cfg = await loadChatbotConfig();
    const t = await testKey(key, cfg.model);
    const currentWorks = cfg.keyState === 'present' && cfg.keyStatus === 'ok';
    if (t.status === 'invalid') {
      return {
        ok: false,
        error: `${t.detail} The new key was NOT saved${cfg.keyState === 'present' ? ' - your current key is unchanged' : ''}.`,
        status: 400,
      };
    }
    if (t.status !== 'ok' && currentWorks) {
      return {
        ok: false,
        error: `Could not confirm the new key: ${t.detail} The new key was NOT saved - your current key is still in use. Try again in a minute.`,
        status: t.status === 'billing' ? 400 : 503,
      };
    }
    // ok - or billing / a temporary error while no working key exists (saving
    // cannot make the chat worse; the status shows what is wrong).
    await setApiKey(key, adminEmail);
    await setKeyStatus(t.status, t.status === 'ok' ? null : t.detail);
    return {
      ok: true,
      body: { key: keyObject(await loadChatbotConfig()), test: { ok: t.status === 'ok', status: t.status, detail: t.detail } },
    };
  }

  // test
  const cfg = await loadChatbotConfig();
  if (cfg.keyState === 'none') return { ok: false, error: 'No API key saved.', status: 400 };
  const key = cfg.keyState === 'present' ? await getDecryptedApiKey() : null;
  if (!key) return { ok: false, error: 'The saved key cannot be decrypted - please re-enter it.', status: 409 };
  const t = await testKey(key, cfg.model);
  await setKeyStatus(t.status, t.status === 'ok' ? null : t.detail);
  return {
    ok: true,
    body: { key: keyObject(await loadChatbotConfig()), test: { ok: t.status === 'ok', status: t.status, detail: t.detail } },
  };
}

const FILTERS: readonly SessionFilter[] = ['all', 'leads', 'errors', 'refusals'];

/** GET /api/chatbot/sessions?offset=&limit=&filter= */
export async function chatbotSessions(url: URL): Promise<AdminResult> {
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  const f = url.searchParams.get('filter') || 'all';
  const filter: SessionFilter = (FILTERS as readonly string[]).includes(f) ? (f as SessionFilter) : 'all';
  return { ok: true, body: await listSessions({ offset, limit, filter }) };
}

/** GET /api/chatbot/sessions/[id] - one transcript, never the raw content. */
export async function chatbotTranscript(id: string): Promise<AdminResult> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'Invalid session id.', status: 400 };
  const t = await getSessionTranscript(id);
  if (!t) return { ok: false, error: 'Chat not found.', status: 404 };
  return { ok: true, body: t };
}

/** Error text for an admin chatbot route: scrubbed, short, logged without
 *  request bodies. */
export function adminErrorMessage(e: unknown, where: string): string {
  const msg = scrubSecrets(e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 300);
  console.error(`[chatbot] ${where} failed: ${msg}`);
  return 'Something went wrong. Please try again; if it keeps failing, tell the developer.';
}
