import { prisma } from '@/lib/db';

/**
 * The link to a partner catalogue we IMPORT from — today Hotelic Essentials.
 *
 * The mirror of lib/sync-auth.ts, which guards what we publish. Settings-backed
 * rather than env-backed so changing a domain is a form edit, not a redeploy.
 * Nothing is hardcoded; the fields ship blank.
 *
 * The API key never leaves this module — callers only ever see a masked form.
 */

export const PARTNER_SOURCE = 'hotelic-essentials';
export const PARTNER_LABEL = 'Hotelic Essentials';

const URL_KEY = 'sync_he_base_url';
const KEY_KEY = 'sync_he_api_key';

/** Beyond this the partner is considered down rather than slow. */
const REQUEST_TIMEOUT_MS = 30_000;

/** What the partner's feed hangs off, appended when the operator omits it. */
const FEED_PATH = '/api/v1/partner/sync';

export interface ConnectionStatus {
  configured: boolean;
  base_url: string | null;
  api_key_masked: string | null;
  source: string;
  source_label: string;
}

export interface TestResult {
  ok: boolean;
  message: string;
  remote?: {
    source: string | null;
    source_label: string | null;
    sync_version: number | null;
    connected_as: string | null;
    products_total: number | null;
    products_active: number | null;
  };
}

async function readSetting(key: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return (row?.value ?? '').trim();
}

async function writeSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value, dataType: 'string' },
  });
}

export async function getConnection(): Promise<{ baseUrl: string; apiKey: string }> {
  const [baseUrl, apiKey] = await Promise.all([readSetting(URL_KEY), readSetting(KEY_KEY)]);
  return { baseUrl, apiKey };
}

export async function connectionStatus(): Promise<ConnectionStatus> {
  const { baseUrl, apiKey } = await getConnection();
  return {
    configured: baseUrl !== '' && apiKey !== '',
    base_url: baseUrl || null,
    api_key_masked:
      apiKey.length > 10 ? `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}` : apiKey ? '••••' : null,
    source: PARTNER_SOURCE,
    source_label: PARTNER_LABEL,
  };
}

/**
 * Normalises whatever the operator pasted into a base we can append paths to.
 * People paste the panel root, a full endpoint, or a trailing slash — all three
 * should work rather than failing with an opaque 404.
 */
export function normaliseBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (url === '') throw new Error('The sync URL is required.');

  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  try {
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    throw new Error(`"${raw}" is not a valid URL.`);
  }

  // Trim a pasted endpoint back to the feed base.
  url = url.replace(/\/(ping|manifest|products)(\/.*)?$/i, '');
  if (!url.toLowerCase().endsWith(FEED_PATH)) {
    url = url.replace(/\/api(\/v1)?(\/partner)?(\/sync)?$/i, '') + FEED_PATH;
  }

  return url;
}

/**
 * Saves the connection. A blank key means "keep the stored one", so a URL can
 * be corrected without re-pasting the secret.
 */
export async function saveConnection(baseUrl: string, apiKey?: string): Promise<void> {
  const normalised = normaliseBaseUrl(baseUrl);
  const current = await getConnection();
  const key = apiKey && apiKey.trim() !== '' ? apiKey.trim() : current.apiKey;
  if (!key) {
    throw new Error(
      'An API key is required for the first connection. Issue one in the Hotelic Essentials admin under Catalogue Sync.',
    );
  }
  await writeSetting(URL_KEY, normalised);
  await writeSetting(KEY_KEY, key);
}

/** Forgets the connection. Imported products and history are kept. */
export async function disconnect(): Promise<void> {
  await writeSetting(URL_KEY, '');
  await writeSetting(KEY_KEY, '');
}

/**
 * One authenticated GET against the partner feed, returning the unwrapped
 * body. Throws with an operator-readable message — this runs behind buttons,
 * where the message is the product.
 */
export async function partnerGet<T = any>(
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const { baseUrl, apiKey } = await getConnection();
  if (!baseUrl || !apiKey) {
    throw new Error(
      `No catalogue connection yet — add the ${PARTNER_LABEL} sync URL and API key first.`,
    );
  }
  return request<T>(baseUrl, apiKey, path, query);
}

async function request<T>(
  baseUrl: string,
  apiKey: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  const url = `${baseUrl}${path}${qs ? `?${qs}` : ''}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'X-Sync-Key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch {
    throw new Error(
      `Could not reach ${baseUrl} — check the URL and that the partner panel is online.`,
    );
  }

  if (response.status === 401) {
    throw new Error(
      `${PARTNER_LABEL} rejected the API key. Issue a new one in its admin under Catalogue Sync and paste it here.`,
    );
  }
  if (response.status === 404) {
    throw new Error(
      `${baseUrl} does not expose a sync feed (404). Check the URL — it should end in ${FEED_PATH}.`,
    );
  }

  const body: any = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      body?.message ?? body?.error ?? `The partner panel answered HTTP ${response.status}.`,
    );
  }
  if (body === null) {
    throw new Error(`${baseUrl} did not return JSON — that URL is probably not a partner panel.`);
  }

  // The partner wraps responses in { success, message, data }; unwrap when present.
  return (body && typeof body === 'object' && 'data' in body ? body.data : body) as T;
}

/**
 * Round-trips /ping with either the candidate credentials from the form or the
 * stored ones. Reports the outcome instead of throwing — this is the "Test
 * connection" button, where a failure is the answer.
 */
export async function testConnection(baseUrl?: string, apiKey?: string): Promise<TestResult> {
  const current = await getConnection();

  let url: string;
  try {
    url = baseUrl?.trim() ? normaliseBaseUrl(baseUrl) : current.baseUrl;
  } catch (e: any) {
    return { ok: false, message: e?.message ?? 'That is not a valid URL.' };
  }
  const key = apiKey?.trim() || current.apiKey;

  if (!url || !key) {
    return { ok: false, message: 'Both the sync URL and an API key are required.' };
  }

  try {
    const body = await request<any>(url, key, '/ping');
    const label = body?.source_label ?? PARTNER_LABEL;
    return {
      ok: true,
      message: `Connected to ${label} as "${body?.connected_as ?? 'unnamed key'}" — ${body?.products_total ?? 0} listing(s) available.`,
      remote: {
        source: body?.source ?? null,
        source_label: body?.source_label ?? null,
        sync_version: body?.sync_version ?? null,
        connected_as: body?.connected_as ?? null,
        products_total: body?.products_total ?? null,
        products_active: body?.products_active ?? null,
      },
    };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? 'The connection test failed.' };
  }
}
