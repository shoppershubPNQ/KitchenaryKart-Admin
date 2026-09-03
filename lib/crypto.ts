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
 * THE KEY LIVES IN THE ENVIRONMENT, NEVER IN THE DATABASE. Keeping it beside
 * the ciphertext it opens would make the encryption decorative — the same as
 * leaving the safe key inside the safe.
 *
 * The owner should not have to add a Vercel variable to use the Integrations
 * page, so the key is DERIVED from `JWT_SECRET`, which every deployment
 * already has (lib/auth.ts signs sessions with it). HKDF with a fixed salt and
 * info string turns that secret into a separate 32-byte key, so the two uses
 * never share key material even though they share a source.
 *
 * `INTEGRATION_ENC_KEY` still wins when set — worth doing eventually, because
 * rotating JWT_SECRET (which only logs everyone out today) would otherwise
 * also make stored credentials unreadable. The Integrations page handles that
 * case explicitly rather than silently: it says "cannot decrypt — re-enter".
 */
import crypto from 'node:crypto';

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const HKDF_SALT = 'kk-integration-credentials-v1';
const HKDF_INFO = 'aes-256-gcm-credential-key';

/** Null (never throws) when no usable secret exists, so callers can report
 *  "not configured" instead of crashing a page. */
function getKey(): Buffer | null {
  // 1. An explicit dedicated key, if the owner ever sets one.
  const explicit = process.env.INTEGRATION_ENC_KEY?.trim();
  if (explicit) {
    try {
      const buf = /^[0-9a-f]{64}$/i.test(explicit)
        ? Buffer.from(explicit, 'hex')
        : Buffer.from(explicit, 'base64');
      if (buf.length === 32) return buf;
    } catch {
      /* fall through to the derived key rather than failing outright */
    }
  }

  // 2. Otherwise derive one from the session secret this app already has.
  const jwt = process.env.JWT_SECRET?.trim();
  // The seeded development placeholder is not a secret; refusing it stops a
  // local machine from writing credentials that production could not read.
  if (!jwt || jwt === 'dev-secret-change-me') return null;
  try {
    return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(jwt), HKDF_SALT, HKDF_INFO, 32));
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
