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
import { buildBackInStockEmail } from '@/lib/email-templates/back-in-stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SITE = 'https://kitchenarykart.com';
/** Safety valve so one run can't blow the Resend quota on a huge restock. */
const MAX_EMAILS_PER_RUN = 200;


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
    const { subject, html, text } = buildBackInStockEmail({ productName: meta.name, url: `${SITE}/product/${encodeURIComponent(row.productSku)}` });
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
