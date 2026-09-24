/**
 * GET /api/analytics/checkout-feedback?days=28
 *
 * Why shoppers left checkout without paying, in their own words. The
 * abandoned-checkout alert counts the lost carts; this says why they were
 * lost, which is the part nothing else records.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Mirrors web/lib/checkout-feedback.ts — labels only; keys are the contract. */
const LABELS: Record<string, string> = {
  price_high: 'Price is too high',
  need_details: 'I need more product details',
  want_to_talk: 'I want to talk to someone first',
  payment_missing: 'My preferred payment option is missing',
  checkout_problem: 'I had a problem at checkout',
  still_deciding: "I'm still deciding",
  other: 'Other',
};

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 28, 1), 365);
    const since = new Date(Date.now() - days * 86_400_000);

    const rows = await prisma.checkoutFeedback.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, reason: true, note: true, cartValue: true, itemCount: true, createdAt: true, sessionId: true },
    });

    // Counted here rather than in SQL: a few hundred answers a month at most,
    // and it keeps the lost-value sum beside the count without a second query.
    const byReason = new Map<string, { count: number; lostValue: number }>();
    let lostValue = 0;
    for (const r of rows) {
      const v = Number(r.cartValue ?? 0);
      lostValue += v;
      const cur = byReason.get(r.reason) ?? { count: 0, lostValue: 0 };
      cur.count++;
      cur.lostValue += v;
      byReason.set(r.reason, cur);
    }

    const reasons = [...byReason.entries()]
      .map(([key, v]) => ({
        key,
        label: LABELS[key] ?? key,
        count: v.count,
        lostValue: Math.round(v.lostValue * 100) / 100,
        share: rows.length ? Math.round((v.count / rows.length) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Every "Other" answer, newest first — the wording is the whole point of
    // that option, so it is never summarised away.
    const notes = rows
      .filter((r) => r.note)
      .slice(0, 100)
      .map((r) => ({
        id: String(r.id),
        note: r.note,
        cartValue: r.cartValue === null ? null : Number(r.cartValue),
        createdAt: r.createdAt,
      }));

    return ok({
      days,
      total: rows.length,
      lostValue: Math.round(lostValue * 100) / 100,
      reasons,
      notes,
      recent: rows.slice(0, 50).map((r) => ({
        id: String(r.id),
        reason: r.reason,
        label: LABELS[r.reason] ?? r.reason,
        note: r.note,
        cartValue: r.cartValue === null ? null : Number(r.cartValue),
        itemCount: r.itemCount,
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
});
