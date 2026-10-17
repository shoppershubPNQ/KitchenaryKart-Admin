/**
 * Abuse and cost protection for the PUBLIC chat route: client IP + IP hash,
 * atomic fixed-window counters in Postgres (the admin app has no Redis),
 * today's approximate spend, and the IST day helpers.
 *
 * Every query is a tagged `$queryRaw` (parameterised) - never `Unsafe` with
 * user input. Time is computed in SQL as UTC to match the TIMESTAMP(3)
 * columns, which Prisma writes in UTC.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { prisma } from '../db';

// ------------------------------------------------------------ client IP
//
// The widget reaches this route through the storefront's /admin-api rewrite,
// i.e. through a second Vercel deployment. Whether x-forwarded-for then still
// carries the shopper's IP (and not the storefront proxy's) is not documented,
// so the storefront can vouch for the IP instead: with CHATBOT_PROXY_SECRET
// set to the SAME long random value in BOTH Vercel projects, web/middleware.ts
// adds x-kk-client-ip / -ts / -sig (HMAC of the IP it saw). Only a correctly
// signed, fresh header is trusted; anything else falls back to the proxy
// headers (a direct caller's x-forwarded-for is its real IP).
// Check after deploy: Dashboard -> Chatbot -> Usage compares chats with
// distinct visitor networks.

const PROXY_HEADER_MAX_AGE_SEC = 120;

/** The shared signing secret, or null when not configured (>= 32 chars). */
export function chatProxySecret(): string | null {
  const s = process.env.CHATBOT_PROXY_SECRET?.trim();
  return s && s.length >= 32 ? s : null;
}

/** Same message and encoding as web/middleware.ts. */
export function signClientIp(secret: string, ip: string, ts: string): string {
  return createHmac('sha256', secret).update(`kk-chat-ip-v1|${ip}|${ts}`).digest('hex');
}

/** The storefront-signed visitor IP, or null (no secret, missing, stale or bad signature). */
function signedProxyIp(req: NextRequest): string | null {
  const secret = chatProxySecret();
  if (!secret) return null;
  const ip = req.headers.get('x-kk-client-ip')?.trim();
  const ts = req.headers.get('x-kk-client-ts')?.trim();
  const sig = req.headers.get('x-kk-client-sig')?.trim().toLowerCase();
  if (!ip || ip.length > 64 || !ts || !/^\d{9,11}$/.test(ts) || !sig || !/^[0-9a-f]{64}$/.test(sig)) return null;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > PROXY_HEADER_MAX_AGE_SEC) return null;
  const want = signClientIp(secret, ip, ts);
  return timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(want, 'utf8')) ? ip : null;
}

/** Expand an IPv6 address to 8 lower-case hextets without leading zeros, or null. */
function expandIpv6(raw: string): string[] | null {
  let s = raw.toLowerCase();
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return null;
    s = s.slice(0, v4.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (all.length !== 8 || all.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  return all.map((h) => h.replace(/^0+(?=.)/, ''));
}

/**
 * One rate-limit identity per visitor network: IPv4 as is (IPv4-mapped IPv6
 * unwrapped, a :port dropped), IPv6 cut to its /64 - a phone or a VPS gets a
 * whole /64, so counting full addresses would let one client change address
 * on every request.
 */
export function normalizeIp(raw: string): string | null {
  let ip = raw.trim().replace(/^\[/, '').replace(/\](:\d+)?$/, '').replace(/%.*$/, '');
  if (!ip || ip.length > 64) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) ip = mapped[1];
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})?$/.exec(ip);
  if (v4) return v4[1];
  if (!ip.includes(':')) return ip.toLowerCase();
  const h = expandIpv6(ip);
  return h ? `${h.slice(0, 4).join(':')}::/64` : ip.toLowerCase();
}

let warnedUnsigned = false;
/** Logged once per cold start in production (never a value): without a signed
 *  IP, a request through the /admin-api rewrite may carry the storefront
 *  proxy's address, so every shopper would share one per-visitor limit (and
 *  one photo limit). Fix: CHATBOT_PROXY_SECRET, 32+ characters, the same value
 *  in BOTH Vercel projects (Dashboard -> Chatbot shows whether it is set). */
function noteUnsignedIp(): void {
  if (warnedUnsigned || process.env.NODE_ENV !== 'production') return;
  warnedUnsigned = true;
  console.warn(
    chatProxySecret()
      ? '[chatbot] a chat request without a valid signed visitor IP (missing, stale or bad x-kk-client-sig) - using proxy headers'
      : '[chatbot] CHATBOT_PROXY_SECRET is not set - visitor IPs come from proxy headers and may all be the storefront proxy',
  );
}

/** The visitor network for rate limits: storefront-signed IP first, then
 *  x-forwarded-for / x-real-ip (same order as web/lib/rate-limit.ts). */
export function clientIp(req: NextRequest): string | null {
  const signed = signedProxyIp(req);
  if (!signed) noteUnsignedIp();
  const raw = signed ?? (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip'))?.split(',')[0]?.trim();
  return raw ? normalizeIp(raw) : null;
}

/** HMAC of the IP - the IP itself is never stored. */
export function hashIp(ip: string): string {
  const secret = process.env.JWT_SECRET?.trim() || 'kk-dev';
  return createHmac('sha256', secret).update('kk-chatbot-ip-v1|' + ip).digest('hex').slice(0, 32);
}

/** Rate-limit bucket for requests that carry no client IP at all: they share one. */
export const UNKNOWN_IP_BUCKET = 'unknown';

let warnedNoIp = false;
/** Logged once per cold start, without any value. */
export function noteMissingIp(): void {
  if (warnedNoIp) return;
  warnedNoIp = true;
  console.warn('[chatbot] no client IP header on a chat request - such requests share one "unknown" visitor limit');
}

const IST_MS = 330 * 60 * 1000;
/** "YYYY-MM-DD" of the IST calendar day. */
export const istDayKey = (d = new Date()) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
/** UTC instant at which the IST day of `d` began. */
export const istDayStartUtc = (d = new Date()) => new Date(Date.parse(istDayKey(d) + 'T00:00:00Z') - IST_MS);

/** Mon-Sat 10:00-19:00 IST - the sales team's hours. */
export function withinSalesHours(d = new Date()): boolean {
  const ist = new Date(d.getTime() + IST_MS);
  const day = ist.getUTCDay();
  const h = ist.getUTCHours();
  return day >= 1 && day <= 6 && h >= 10 && h < 19;
}

export interface LimitResult {
  ok: boolean;
  count: number;
  retryAfterSec: number;
}

/**
 * Fixed-window counter, atomic in one statement. Returns the count AFTER this
 * hit; `ok` while it is within `limit`.
 */
export async function hitLimit(key: string, windowSec: number, limit: number): Promise<LimitResult> {
  const rows = await prisma.$queryRaw<Array<{ count: number; window_start: Date }>>`
    INSERT INTO chat_rate_limits (key, window_start, count, updated_at)
    VALUES (${key}, (now() AT TIME ZONE 'UTC'), 1, (now() AT TIME ZONE 'UTC'))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN chat_rate_limits.window_start <= (now() AT TIME ZONE 'UTC') - (${windowSec}::int * interval '1 second')
                   THEN 1 ELSE chat_rate_limits.count + 1 END,
      window_start = CASE WHEN chat_rate_limits.window_start <= (now() AT TIME ZONE 'UTC') - (${windowSec}::int * interval '1 second')
                   THEN (now() AT TIME ZONE 'UTC') ELSE chat_rate_limits.window_start END,
      updated_at = (now() AT TIME ZONE 'UTC')
    RETURNING count, window_start`;
  const row = rows[0];
  const count = Number(row?.count ?? 0);
  const startedMs = row?.window_start instanceof Date ? row.window_start.getTime() : Date.now();
  const retryAfterSec = Math.max(1, Math.ceil(windowSec - (Date.now() - startedMs) / 1000));
  return { ok: count <= limit, count, retryAfterSec };
}

/** Housekeeping, run on ~1% of requests: drop counters idle for 2 days. */
export async function pruneRateLimits(): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM chat_rate_limits WHERE updated_at < (now() AT TIME ZONE 'UTC') - interval '2 days'`;
}

/** Replies being generated right now, whole website (soft cap + cost
 *  reservation). A claimed chat has busy_until set for up to 90 s and was
 *  updated within that time, so the updated_at index narrows the scan. */
export async function inFlightTurns(): Promise<number> {
  const now = Date.now();
  return prisma.chatSession.count({
    where: { busyUntil: { gt: new Date(now) }, updatedAt: { gt: new Date(now - 120_000) } },
  });
}

/** Approximate USD spent today (IST day), from the stored per-message costs. */
export async function todayCostUsd(): Promise<number> {
  const agg = await prisma.chatMessage.aggregate({
    _sum: { costUsd: true },
    where: { createdAt: { gte: istDayStartUtc() } },
  });
  return Number(agg._sum.costUsd ?? 0);
}
