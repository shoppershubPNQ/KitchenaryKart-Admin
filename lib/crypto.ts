/**
 * Encryption for third-party credentials stored in the database.
 *
 * Every other integration in this codebase reads its secrets from env vars
 * (see lib/integrations/razorpay.ts). The courier credentials are different:
 * the owner needs to enter and rotate them from the admin UI, so they have to
 * live in Postgres. That makes encryption non-optional — a database dump must
 * not be a credential dump.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails to decrypt rather
 * than yielding garbage. Stored as "v1.<iv>.<tag>.<ciphertext>", all base64url,
 * with the version prefix so the scheme can change later without guessing.
 *
 * THE KEY LIVES IN THE ENVIRONMENT, NEVER IN THE DATABASE (INTEGRATION_ENC_KEY,
 * 32 bytes as base64 or 64 hex chars). Without it nothing decrypts, which is
 * the point: a stolen dump is inert. Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
import crypto from 'node:crypto';

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';

/** Null (never throws) when the key is absent or malformed, so callers can
 *  report "not configured" instead of crashing a page. */
function getKey(): Buffer | null {
  const raw = process.env.INTEGRATION_ENC_KEY;
  if (!raw) return null;
  try {
    const buf = /^[0-9a-f]{64}$/i.test(raw.trim())
      ? Buffer.from(raw.trim(), 'hex')
      : Buffer.from(raw.trim(), 'base64');
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

/** True when credentials can actually be read/written. Mirrors the
 *  `xEnabled` convention used by the other integration modules. */
export const encryptionAvailable = getKey() !== null;

export function encryptJson(value: unknown): string {
  const key = getKey();
  if (!key) throw new Error('INTEGRATION_ENC_KEY is not set — cannot store credentials');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

/** Returns null rather than throwing on a bad key, a tampered blob or a
 *  version we do not understand — the caller shows "reconnect" instead of a
 *  500 that would take the whole Integrations page down. */
export function decryptJson<T = Record<string, string>>(blob: string | null | undefined): T | null {
  if (!blob) return null;
  const key = getKey();
  if (!key) return null;
  const parts = blob.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const out = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]);
    return JSON.parse(out.toString('utf8')) as T;
  } catch {
    return null;
  }
}

/** "••••4821" — what the Integrations page shows instead of the secret. A
 *  short value is masked entirely; four visible characters are only enough to
 *  recognise a key you already hold. */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 4) return '••••';
  return '••••' + s.slice(-4);
}

/** Constant-time compare for the webhook shared secrets. Neither courier signs
 *  its payload, so this header check is the whole of the authentication —
 *  it must not leak the secret through timing. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
