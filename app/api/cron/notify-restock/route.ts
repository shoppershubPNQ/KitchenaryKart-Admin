/**
 * Hourly cron: email customers whose "notify me when available" product is
 * back in stock.
 *
 * Deliberately STATELESS — it never tries to detect a 0 → N transition, which
 * would mean tracking previous stock and would miss restocks that happen via
 * bulk import, a variant edit, or an order cancellation. Instead it asks a
 * simpler question every run: "of the requests still waiting, which SKUs have
 * stock right now?" Those get emailed and stamped `notifiedAt`, so nobody is
 * mailed twice (a repeat request from the customer re-arms the row).
 *
 * The stored SKU may be a PARENT product sku or a VARIANT sku
 * (ProductVariant.skuSuffix); both are resolved here.
 *
 * Security: Vercel signs cron requests with CRON_SECRET (same as
 * cancel-stale-orders).
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/integrations/resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SITE = 'https://kitchenarykart.com';
/** Safety valve so one run can't blow the Resend quota on a huge restock. */
const MAX_EMAILS_PER_RUN = 200;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildEmail(productName: string, sku: string) {
  const url = `${SITE}/product/${encodeURIComponent(sku)}`;
  const name = escapeHtml(productName);
  return {
    subject: `Back in stock: ${productName}`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.6;max-width:560px">
  <h2 style="margin:0 0 10px;font-size:19px;color:#9E2A2B">It's back in stock</h2>
  <p style="margin:0 0 14px">You asked us to let you know when <b>${name}</b> was available again — it is.</p>
  <p style="margin:0 0 20px">
    <a href="${url}" style="background:#9E2A2B;color:#fff;text-decoration:none;padding:11px 22px;border-radius:6px;display:inline-block;font-weight:bold">View product</a>
  </p>
  <p style="margin:0 0 18px;color:#555;font-size:13.5px">Stock is limited and we can't hold it — order soon if you still need it.</p>
  <p style="margin:0 0 12px">Need it urgently or in bulk? Talk to us directly:</p>
  <p style="margin:0 0 18px">
    <a href="https://wa.me/919890352455" style="background:#25D366;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;display:inline-block;font-weight:bold;margin:0 8px 8px 0">WhatsApp us</a>
    <a href="tel:+919890352455" style="background:#1a1a1a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;display:inline-block;font-weight:bold;margin:0 8px 8px 0">Call +91 98903 52455</a>
  </p>
  <p style="margin:16px 0 0;color:#777;font-size:12.5px">You're getting this because you requested a stock alert on kitchenarykart.com. It's a one-time email for this product.</p>
</div>`,
    text: `It's back in stock\n\nYou asked us to let you know when "${productName}" was available again — it is.\n\n${url}\n\nStock is limited and we can't hold it — order soon if you still need it.\n\nNeed it urgently or in bulk? Talk to us directly:\nWhatsApp: https://wa.me/919890352455\nCall: +91 98903 52455\n\nYou're getting this because you requested a stock alert on kitchenarykart.com.`,
  };
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (expected && authHeader !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const pending = await prisma.stockNotification.findMany({
    where: { notifiedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, productSku: true, email: true },
  });
  if (pending.length === 0) {
    return NextResponse.json({ ok: true, pending: 0, sent: 0 });
  }

  // Resolve every waiting SKU once: name + current stock, from the parent
  // table first and the variant table for the rest.
  const skus = [...new Set(pending.map((p) => p.productSku))];
  const info = new Map<string, { name: string; stock: number }>();

  const parents = await prisma.product.findMany({
    where: { sku: { in: skus } },
    select: { sku: true, name: true, stock: true },
  });
  for (const p of parents) info.set(p.sku, { name: p.name, stock: p.stock });

  const missing = skus.filter((s) => !info.has(s));
  if (missing.length) {
    const variants = await prisma.productVariant.findMany({
      where: { skuSuffix: { in: missing } },
      select: { skuSuffix: true, variantValue: true, stock: true, product: { select: { name: true } } },
    });
    for (const v of variants) {
      if (!v.skuSuffix || !v.product) continue;
      info.set(v.skuSuffix, {
        name: v.variantValue ? `${v.product.name} — ${v.variantValue}` : v.product.name,
        stock: v.stock,
      });
    }
  }

  const ready = pending.filter((p) => (info.get(p.productSku)?.stock ?? 0) > 0);
  const batch = ready.slice(0, MAX_EMAILS_PER_RUN);

  let sent = 0;
  const failed: number[] = [];
  for (const row of batch) {
    const meta = info.get(row.productSku)!;
    const { subject, html, text } = buildEmail(meta.name, row.productSku);
    const ok = await sendEmail({ to: row.email, subject, html, text, category: 'back-in-stock' });
    if (ok) {
      // Stamp only on a confirmed send, so a Resend outage retries next hour
      // instead of silently dropping the customer's alert.
      await prisma.stockNotification.update({ where: { id: row.id }, data: { notifiedAt: new Date() } });
      sent++;
    } else {
      failed.push(row.id);
    }
  }

  return NextResponse.json({
    ok: true,
    pending: pending.length,
    readyToSend: ready.length,
    sent,
    failed: failed.length,
    deferredToNextRun: Math.max(0, ready.length - batch.length),
  });
}
