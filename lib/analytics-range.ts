/** Shared helpers for the visitor-analytics API routes. */
import type { NextRequest } from 'next/server';

/** Ranges the dashboard offers. 28 is GA4's default month; 365 lets the sales
 *  metrics (which go back much further than visitor tracking) be useful. */
export const RANGE_DAYS = [1, 7, 14, 28, 30, 90, 180, 365] as const;

/** ?days= one of RANGE_DAYS (default 7). */
export function rangeDays(req: NextRequest): number {
  const d = parseInt(new URL(req.url).searchParams.get('days') || '7', 10);
  return (RANGE_DAYS as readonly number[]).includes(d) ? d : 7;
}

/** $queryRaw returns COUNT(*) as bigint, which JSON cannot carry. */
export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** Staff test checkouts — same rule as the abandoned-checkout alerts. */
export const isInternalCustomer = (email: string | null | undefined, name: string | null | undefined) =>
  /@hotelicessentials\.com$/i.test(email ?? '') || /\btest\b/i.test(`${name ?? ''} ${email ?? ''}`);
