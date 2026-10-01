/**
 * Reads and writes the encrypted courier credentials.
 *
 * Every caller goes through here so decryption, the "is it configured" test
 * and the Shiprocket token cache exist in exactly one place.
 */
import crypto from 'node:crypto';
import { prisma } from './db';
import { encryptJson, decryptJson, encryptionAvailable } from './crypto';
import type { ShipmentProvider } from '@prisma/client';

export interface ShiprocketCreds {
  email: string;
  password: string;
  pickupLocation?: string;
  channelId?: string;
}
export interface DelhiveryCreds {
  apiToken: string;
  clientName: string;
  pickupLocation?: string;
  /** Pincode of that pickup warehouse — the origin for rate and delivery-time
   *  lookups. Falls back to the company address pincode when blank. */
  pickupPincode?: string;
  /** Staging is a genuinely different host, so it is a stored choice rather
   *  than an env flag — the owner may want to rehearse before going live. */
  useStaging?: boolean;
}
export type Creds = ShiprocketCreds | DelhiveryCreds;

/** Which fields are secret, for masking on the way out to the browser. */
export const SECRET_FIELDS: Record<ShipmentProvider, string[]> = {
  shiprocket: ['password'],
  delhivery: ['apiToken'],
};

export async function getCreds<T extends Creds>(provider: ShipmentProvider): Promise<T | null> {
  if (!encryptionAvailable) return null;
  const row = await prisma.integrationCredential.findUnique({ where: { provider } });
  if (!row?.isActive || !row.encrypted) return null;
  return decryptJson<T>(row.encrypted);
}

/** Configured AND switched on. Mirrors the `xEnabled` convention used by the
 *  other integration modules, but async because these live in the DB. */
export async function providerEnabled(provider: ShipmentProvider): Promise<boolean> {
  return (await getCreds(provider)) !== null;
}

export async function saveCreds(
  provider: ShipmentProvider,
  creds: Record<string, unknown>,
  isActive: boolean,
): Promise<void> {
  const encrypted = encryptJson(creds);
  await prisma.integrationCredential.upsert({
    where: { provider },
    create: {
      provider,
      encrypted,
      isActive,
      // Minted once and shown to the owner to paste into the courier's webhook
      // config. Neither courier signs its payloads, so this shared secret is
      // the whole of the authentication on an incoming scan.
      webhookSecret: crypto.randomBytes(24).toString('base64url'),
    },
    // A new secret would silently break a webhook already registered with the
    // courier, so it is never regenerated on update.
    update: { encrypted, isActive, lastError: null, lastVerifiedAt: null, cachedToken: null, tokenExpiresAt: null },
  });
}

export async function setVerified(provider: ShipmentProvider, error: string | null): Promise<void> {
  await prisma.integrationCredential.update({
    where: { provider },
    data: error ? { lastError: error } : { lastVerifiedAt: new Date(), lastError: null },
  });
}

/**
 * Shiprocket's JWT is valid 240 hours. A cold Vercel lambda has no memory, so
 * the token is persisted; without this every request would re-login and
 * Shiprocket rate-limits that.
 *
 * Refreshed an hour early so a token cannot expire mid-request.
 */
export async function getCachedToken(provider: ShipmentProvider): Promise<string | null> {
  const row = await prisma.integrationCredential.findUnique({ where: { provider } });
  if (!row?.cachedToken || !row.tokenExpiresAt) return null;
  return row.tokenExpiresAt.getTime() - 60 * 60 * 1000 > Date.now() ? row.cachedToken : null;
}

export async function setCachedToken(
  provider: ShipmentProvider,
  token: string,
  expiresAt: Date,
): Promise<void> {
  await prisma.integrationCredential.update({
    where: { provider },
    data: { cachedToken: token, tokenExpiresAt: expiresAt },
  });
}

/** Stored on the row when a courier login fails; marks the failure as a
 *  LOGIN failure (other test failures do not pause logins). */
export const LOGIN_FAILED_PREFIX = 'Login failed: ';
const LOGIN_PAUSE_MS = 30 * 60 * 1000;

/**
 * Couriers lock an account after a few failed logins (Shiprocket: 30 min,
 * then 2 h). After one failure, automatic retries — the hourly poll, a Refresh
 * click — would only extend the lock, so logins pause for 30 minutes.
 * Saving the credentials again clears the stored error and lifts the pause.
 * Returns the reason while paused, else null.
 */
export async function loginPausedReason(provider: ShipmentProvider): Promise<string | null> {
  const row = await prisma.integrationCredential.findUnique({
    where: { provider },
    select: { lastError: true, updatedAt: true },
  });
  if (!row?.lastError?.startsWith(LOGIN_FAILED_PREFIX)) return null;
  const left = LOGIN_PAUSE_MS - (Date.now() - row.updatedAt.getTime());
  if (left <= 0) return null;
  return `${row.lastError.slice(LOGIN_FAILED_PREFIX.length)} — logins paused for ${Math.ceil(left / 60000)} more min so the account is not locked. Fix the API user in Integrations and Save (that lifts the pause).`;
}

/** A login just worked: drop a stale "Login failed" marker so the pages stop
 *  showing it (other stored errors, e.g. a Test result, are left alone). */
export async function clearLoginFailure(provider: ShipmentProvider): Promise<void> {
  await prisma.integrationCredential.updateMany({
    where: { provider, lastError: { startsWith: LOGIN_FAILED_PREFIX } },
    data: { lastError: null },
  });
}

export async function getWebhookSecret(provider: ShipmentProvider): Promise<string | null> {
  const row = await prisma.integrationCredential.findUnique({
    where: { provider },
    select: { webhookSecret: true },
  });
  return row?.webhookSecret ?? null;
}
