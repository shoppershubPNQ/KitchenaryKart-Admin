/**
 * Every 15 minutes: email the team about website checkouts that were started
 * but not paid, so someone can call the buyer the same day.
 *
 * Why: in Jul–Sep 2026, 55 real checkouts went unpaid; 26 of those buyers came
 * back and paid, 29 never did — including big-ticket carts nobody followed up.
 * The Abandoned carts page lists them, but only if someone opens it.
 *
 * Rules (same idea as /api/orders/abandoned, plus safety checks):
 *   - website checkout (has a razorpayOrderId), still pending/pending
 *   - 30 minutes to 24 hours old — long enough for a retry to land, and the
 *     24h auto-cancel takes over after that
 *   - not "Mark contacted", not already alerted
 *   - staff test checkouts (hotelicessentials.com / "test") are skipped
 *   - Razorpay is asked first: a captured payment is finalized, never alerted
 *   - skipped if the same buyer paid a later order (they retried and bought)
 *   - one email per buyer, however many attempts they made
 *
 * Security: Vercel signs cron requests with CRON_SECRET (same as the others).
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { checkOrderPayment, finalizePaidOrder } from '@/lib/order-payment';
import { sendEmail } from '@/lib/integrations/resend';
import { adminBaseUrl, adminRecipients } from '@/lib/admin-notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MIN_AGE_MINUTES = 30;
const MAX_AGE_HOURS = 24;

const last10 = (p: string | null | undefined) => (p || '').replace(/\D/g, '').slice(-10);
const isInternalTest = (o: { customerName: string | null; customerEmail: string | null }) =>
  /@hotelicessentials\.com$/i.test(o.customerEmail ?? '') ||
  /\btest\b/i.test(`${o.customerName ?? ''} ${o.customerEmail ?? ''}`);

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (expected && req.headers.get('authorization') !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const alerted: string[] = [];
  const recovered: string[] = [];
  const boughtLater: string[] = [];
  const skippedTest: string[] = [];
  const errors: Array<{ orderNumber: string; error: string }> = [];

  try {
    const candidates = await prisma.order.findMany({
      where: {
        orderStatus: 'pending',
        paymentStatus: 'pending',
        razorpayOrderId: { not: null },
        contactedAt: null,
        abandonedAlertAt: null,
        createdAt: {
          lt: new Date(now - MIN_AGE_MINUTES * 60_000),
          gte: new Date(now - MAX_AGE_HOURS * 3_600_000),
        },
      },
      include: { items: { select: { productName: true, productSku: true, quantity: true, unitPrice: true } } },
      orderBy: { createdAt: 'asc' },
    });

    // Buyers who paid recently, or were already alerted in the last day — by
    // phone (stored in mixed formats, so compare the last 10 digits) or email.
    const recent = await prisma.order.findMany({
      where: {
        createdAt: { gte: new Date(now - (MAX_AGE_HOURS + 1) * 3_600_000) },
        OR: [{ paymentStatus: 'completed' }, { abandonedAlertAt: { not: null } }],
      },
      select: { customerPhone: true, customerEmail: true, createdAt: true, paymentStatus: true, abandonedAlertAt: true },
    });
    const sameBuyer = (a: { customerPhone: string | null; customerEmail: string | null }, b: typeof a) =>
      (!!last10(a.customerPhone) && last10(a.customerPhone) === last10(b.customerPhone)) ||
      (!!a.customerEmail && a.customerEmail.toLowerCase() === (b.customerEmail ?? '').toLowerCase());

    // One group per buyer, so three failed attempts become one alert.
    const groups = new Map<string, typeof candidates>();
    for (const o of candidates) {
      if (isInternalTest(o)) {
        skippedTest.push(o.orderNumber);
        continue;
      }
      const key = last10(o.customerPhone) || (o.customerEmail ?? '').toLowerCase() || `order:${o.id}`;
      groups.set(key, [...(groups.get(key) ?? []), o]);
    }

    for (const attempts of groups.values()) {
      const ids = attempts.map((o) => o.id);
      const first = attempts[0];
      const latest = attempts[attempts.length - 1];
      try {
        // 1. Ask Razorpay — the webhook has missed payments before.
        let paid = false;
        for (const o of attempts) {
          const { captured } = await checkOrderPayment(o);
          if (captured) {
            await finalizePaidOrder(o.id, {
              razorpayPaymentId: captured.paymentId,
              amountPaise: captured.amountPaise,
              source: captured.source,
            });
            recovered.push(o.orderNumber);
            paid = true;
          }
        }

        // 2. Bought on a later order, or already alerted about today.
        const later = recent.some(
          (r) =>
            sameBuyer(first, r) &&
            ((r.paymentStatus === 'completed' && r.createdAt > first.createdAt) || r.abandonedAlertAt !== null),
        );

        if (paid || later) {
          if (!paid) boughtLater.push(latest.orderNumber);
          await prisma.order.updateMany({ where: { id: { in: ids } }, data: { abandonedAlertAt: new Date() } });
          continue;
        }

        // 3. Tell the team. Only mark alerted once the email actually went.
        const mail = buildAlertEmail(latest, attempts.length);
        const sent = await sendEmail({
          to: adminRecipients(),
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          category: 'abandoned-checkout',
        });
        if (sent) {
          await prisma.order.updateMany({ where: { id: { in: ids } }, data: { abandonedAlertAt: new Date() } });
          alerted.push(latest.orderNumber);
        } else {
          errors.push({ orderNumber: latest.orderNumber, error: 'email not sent' });
        }
      } catch (e) {
        // Razorpay unreachable etc. — try again on the next run.
        errors.push({ orderNumber: latest.orderNumber, error: e instanceof Error ? e.message : 'failed' });
      }
    }

    return NextResponse.json({
      ok: true,
      checked: candidates.length,
      alerted,
      recovered,
      boughtLater,
      skippedTest,
      errors,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'failed', alerted, recovered, errors },
      { status: 500 },
    );
  }
}

type AlertOrder = {
  id: number;
  orderNumber: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  shippingAddress: string | null;
  totalAmount: unknown;
  createdAt: Date;
  items: Array<{ productName: string | null; productSku: string | null; quantity: number; unitPrice: unknown }>;
};

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const inr = (n: unknown) => '₹' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function buildAlertEmail(o: AlertOrder, attempts: number) {
  const phone10 = last10(o.customerPhone);
  const admin = adminBaseUrl();
  const when = o.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  const name = o.customerName || 'Unknown buyer';
  const subject = `Unpaid checkout ${inr(o.totalAmount)} — ${name}${phone10 ? ` (${phone10})` : ''}`;

  const rows = o.items
    .map(
      (it) =>
        `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${esc(it.productName || it.productSku)}</td>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center">× ${it.quantity}</td>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${inr(Number(it.unitPrice) * it.quantity)}</td></tr>`,
    )
    .join('');

  const html = `
  <div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:560px">
    <h2 style="margin:0 0 4px">Unpaid checkout — call this buyer</h2>
    <p style="margin:0 0 16px;color:#666">They reached payment on the website but did not pay. Razorpay checked: no payment captured.</p>
    <p style="margin:0 0 12px;font-size:15px"><b>${esc(name)}</b><br>
      ${phone10 ? `📞 <a href="tel:+91${phone10}">+91 ${phone10}</a> &nbsp;·&nbsp; <a href="https://wa.me/91${phone10}">WhatsApp</a><br>` : ''}
      ${o.customerEmail ? `✉️ ${esc(o.customerEmail)}<br>` : ''}
      ${o.shippingAddress ? `<span style="color:#666">${esc(o.shippingAddress)}</span>` : ''}</p>
    <table style="border-collapse:collapse;width:100%;margin:0 0 8px">${rows}</table>
    <p style="margin:0 0 16px"><b>Total: ${inr(o.totalAmount)}</b> &nbsp;·&nbsp; started ${esc(when)} &nbsp;·&nbsp; ${attempts} attempt${attempts === 1 ? '' : 's'} &nbsp;·&nbsp; ${esc(o.orderNumber)}</p>
    <p style="margin:0 0 16px">
      <a href="${admin}/dashboard/abandoned-carts" style="background:#9b1c1c;color:#fff;padding:8px 14px;border-radius:4px;text-decoration:none">Open abandoned carts</a>
      &nbsp; <a href="${admin}/dashboard/orders/${o.id}">Open order</a>
    </p>
    <p style="margin:0;color:#888;font-size:12px">After you contact them, click "Mark contacted" on the Abandoned carts page. Unpaid orders are auto-cancelled after 24 hours.</p>
  </div>`;

  const text = [
    'Unpaid checkout — call this buyer',
    `${name}${phone10 ? ` | +91 ${phone10}` : ''}${o.customerEmail ? ` | ${o.customerEmail}` : ''}`,
    ...o.items.map((it) => `- ${it.productName || it.productSku} x ${it.quantity} = ${inr(Number(it.unitPrice) * it.quantity)}`),
    `Total ${inr(o.totalAmount)} | started ${when} | ${attempts} attempt(s) | ${o.orderNumber}`,
    `${admin}/dashboard/abandoned-carts`,
  ].join('\n');

  return { subject, html, text };
}
