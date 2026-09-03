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

export async function getWebhookSecret(provider: ShipmentProvider): Promise<string | null> {
  const row = await prisma.integrationCredential.findUnique({
    where: { provider },
    select: { webhookSecret: true },
  });
  return row?.webhookSecret ?? null;
}
