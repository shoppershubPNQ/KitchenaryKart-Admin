import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';

/**
 * Back-in-stock demand report: which sold-out products customers are asking
 * for, most-wanted first. This is the point of the whole feature — it turns
 * "we're out" into a restocking signal.
 *
 * Grouped by SKU with the waiting/notified split, and each SKU's current stock
 * + name resolved from the parent OR the variant table (the storefront records
 * whichever SKU the shopper was viewing).
 */
export const GET = withAuth(async () => {
  try {
    const rows = await prisma.stockNotification.findMany({
      orderBy: { createdAt: 'desc' },
      select: { productSku: true, email: true, phone: true, createdAt: true, notifiedAt: true },
    });

    const bySku = new Map<
      string,
      {
        sku: string;
        waiting: number;
        notified: number;
        lastRequestedAt: Date;
        emails: string[];
        /** Who to CALL — only the requests that left a number. */
        contacts: { email: string; phone: string }[];
      }
    >();
    for (const r of rows) {
      const e = bySku.get(r.productSku) ?? {
        sku: r.productSku,
        waiting: 0,
        notified: 0,
        lastRequestedAt: r.createdAt,
        emails: [],
        contacts: [],
      };
      if (r.notifiedAt) e.notified++;
      else e.waiting++;
      if (r.createdAt > e.lastRequestedAt) e.lastRequestedAt = r.createdAt;
      if (e.emails.length < 50) e.emails.push(r.email);
      if (r.phone && e.contacts.length < 50) e.contacts.push({ email: r.email, phone: r.phone });
      bySku.set(r.productSku, e);
    }

    const skus = [...bySku.keys()];
    const info = new Map<string, { name: string; stock: number }>();
    if (skus.length) {
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
    }

    const items = [...bySku.values()]
      .map((e) => ({
        ...e,
        name: info.get(e.sku)?.name ?? '(product not found)',
        stock: info.get(e.sku)?.stock ?? 0,
      }))
      // Most-wanted first; still-waiting outranks already-notified.
      .sort((a, b) => b.waiting - a.waiting || b.notified - a.notified);

    return ok({
      items,
      totalRequests: rows.length,
      totalWaiting: rows.filter((r) => !r.notifiedAt).length,
    });
  } catch (e) {
    return handleError(e);
  }
});
