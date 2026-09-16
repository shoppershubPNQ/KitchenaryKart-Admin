/**
 * Daily: ask buyers for a review a few days after their order was delivered.
 *
 * Why: the storefront shows real ratings only (the invented pseudo rating was
 * removed on 2026-09-16), and only a signed-in verified buyer can post a
 * review — so asking the people who actually received the goods is the one
 * way ratings grow.
 *
 * Rules:
 *   - delivered 3 to 30 days ago, payment completed, not cancelled
 *   - has a customer email, and no request sent yet (orders.review_email_at)
 *   - staff test orders skipped (hotelicessentials.com / "test")
 *   - one email per ORDER, listing every product in it
 *   - marked only after the send succeeds, so a failure retries tomorrow
 *
 * Security: Vercel signs cron requests with CRON_SECRET (same as the others).
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/integrations/resend';
import { buildReviewRequestEmail } from '@/lib/email-templates/review-request';
import { isInternalCustomer } from '@/lib/analytics-range';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MIN_DAYS = 3;
const MAX_DAYS = 30;
const STORE_URL = 'https://kitchenarykart.com';
/** Keep one run modest — the rest go out tomorrow. */
const MAX_PER_RUN = 40;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (expected && req.headers.get('authorization') !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const sent: string[] = [];
  const skippedTest: string[] = [];
  const errors: Array<{ orderNumber: string; error: string }> = [];

  try {
    const orders = await prisma.order.findMany({
      where: {
        paymentStatus: 'completed',
        orderStatus: 'delivered',
        reviewEmailAt: null,
        customerEmail: { not: null },
        deliveredAt: {
          lte: new Date(now - MIN_DAYS * 86_400_000),
          gte: new Date(now - MAX_DAYS * 86_400_000),
        },
      },
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        customerEmail: true,
        items: { select: { productName: true, productSku: true } },
      },
      orderBy: { deliveredAt: 'asc' },
      take: MAX_PER_RUN,
    });

    for (const o of orders) {
      if (isInternalCustomer(o.customerEmail, o.customerName)) {
        skippedTest.push(o.orderNumber);
        continue;
      }
      const items = o.items
        .filter((i) => i.productSku)
        .map((i) => ({ name: i.productName || i.productSku!, sku: i.productSku! }));
      if (items.length === 0) continue;

      try {
        const mail = buildReviewRequestEmail({
          orderNumber: o.orderNumber,
          customerName: o.customerName,
          items,
          storeUrl: STORE_URL,
        });
        const ok = await sendEmail({
          to: o.customerEmail!,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          category: 'review-request',
        });
        if (ok) {
          await prisma.order.update({ where: { id: o.id }, data: { reviewEmailAt: new Date() } });
          sent.push(o.orderNumber);
        } else {
          errors.push({ orderNumber: o.orderNumber, error: 'email not sent' });
        }
      } catch (e) {
        errors.push({ orderNumber: o.orderNumber, error: e instanceof Error ? e.message : 'failed' });
      }
    }

    return NextResponse.json({ ok: true, considered: orders.length, sentCount: sent.length, sent, skippedTest, errors });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'failed', sent, errors },
      { status: 500 },
    );
  }
}
