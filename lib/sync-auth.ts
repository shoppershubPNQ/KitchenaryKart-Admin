import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * API-key auth for the outbound catalogue feed (`/api/sync/*`).
 *
 * Partner panels (Hotelic Essentials) have no admin session here, so the sync
 * routes are authenticated by a shared key instead of the JWT cookie. The key
 * is issued once from the Sync tab, shown exactly once, and only ever stored
 * as a SHA-256 hash — the plaintext cannot be recovered from the database.
 *
 * Every sync route is READ-ONLY. A key grants "read the catalogue", nothing
 * else; there is deliberately no write path a partner could reach.
 */

export const SYNC_KEY_HEADER = 'x-sync-key';
const KEY_PREFIX = 'kk_live_';
const PREFIX_DISPLAY_LENGTH = 12;

/** A fresh key: `kk_live_` + 48 hex chars. Returned to the operator once. */
export function generateSyncKey(): { key: string; keyPrefix: string; keyHash: string } {
  const key = KEY_PREFIX + randomBytes(24).toString('hex');
  return {
    key,
    keyPrefix: key.slice(0, PREFIX_DISPLAY_LENGTH),
    keyHash: hashSyncKey(key),
  };
}

export function hashSyncKey(key: string): string {
  return createHash('sha256').update(key.trim()).digest('hex');
}

/** Constant-time compare so a wrong key leaks nothing through response timing. */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface SyncCaller {
  id: number;
  name: string;
  keyPrefix: string;
}

/**
 * Resolves the caller from the `X-Sync-Key` header (an `Authorization: Bearer`
 * header is accepted too, since some HTTP clients make custom headers awkward).
 * Returns null when the key is missing, unknown or revoked.
 */
async function resolveCaller(req: NextRequest): Promise<SyncCaller | null> {
  const header = req.headers.get(SYNC_KEY_HEADER);
  const bearer = req.headers.get('authorization');
  const presented = (header ?? (bearer?.startsWith('Bearer ') ? bearer.slice(7) : '')).trim();
  if (presented === '') return null;

  const hash = hashSyncKey(presented);

  // Look the row up by its unique hash, then re-compare in constant time. The
  // index lookup is what makes this fast; the compare is what makes it safe.
  const row = await prisma.syncApiKey.findUnique({ where: { keyHash: hash } });
  if (!row || row.revokedAt !== null || !hashesMatch(row.keyHash, hash)) return null;

  // Usage stamps are best-effort telemetry for the Sync tab — a failed write
  // must never turn a valid request into a 401.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null;
  prisma.syncApiKey
    .update({
      where: { id: row.id },
      data: { lastUsedAt: new Date(), lastUsedIp: ip, requestCount: { increment: 1 } },
    })
    .catch(() => {});

  return { id: row.id, name: row.name, keyPrefix: row.keyPrefix };
}

/**
 * Wraps a sync route handler with key auth. Mirrors `withAuth` in lib/auth.ts,
 * but for machine callers.
 */
export function withSyncKey(
  handler: (
    req: NextRequest,
    ctx: { caller: SyncCaller; params: any },
  ) => Promise<Response> | Response,
) {
  return async (req: NextRequest, ctx: { params: any }) => {
    const caller = await resolveCaller(req);
    if (!caller) {
      return NextResponse.json(
        {
          error:
            'Invalid or missing sync API key. Send it as an X-Sync-Key header. Keys are issued in the KitchenaryKart admin under Sync.',
        },
        { status: 401 },
      );
    }
    return handler(req, { caller, params: ctx.params });
  };
}

/** CORS preflight support — the partner panel may call this from a browser. */
export function syncCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': `Content-Type, Authorization, ${SYNC_KEY_HEADER}`,
    'Access-Control-Max-Age': '86400',
  };
}
