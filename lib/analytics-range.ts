/** Shared helpers for the visitor-analytics API routes. */
import type { NextRequest } from 'next/server';

/** ?days= one of 1, 7, 30, 90 (default 7). */
export function rangeDays(req: NextRequest): number {
  const d = parseInt(new URL(req.url).searchParams.get('days') || '7', 10);
  return [1, 7, 30, 90].includes(d) ? d : 7;
}

/** $queryRaw returns COUNT(*) as bigint, which JSON cannot carry. */
export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** Staff test checkouts — same rule as the abandoned-checkout alerts. */
export const isInternalCustomer = (email: string | null | undefined, name: string | null | undefined) =>
  /@hotelicessentials\.com$/i.test(email ?? '') || /\btest\b/i.test(`${name ?? ''} ${email ?? ''}`);
