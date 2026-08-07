/**
 * Business-category membership.
 *
 * A business category ("Pizza Equipment") cross-cuts the product taxonomy, so
 * membership can never be a column on Product — one deep fryer belongs to
 * Pizza, Burger and Cafe at once.
 *
 * Membership is a fully CURATED list: `productSkus`, in the order the curator
 * arranged them. There is no rule tying a business category to the existing
 * subcategories — each one is introduced by hand so the selection reflects what
 * a buyer of that format actually needs.
 *
 * This lives in one place and is used by BOTH the admin count and the
 * storefront page — computing membership separately would let the two drift
 * and the admin would show a number the site does not match.
 */
import { prisma } from '@/lib/db';

/** Json columns come back as `unknown`; coerce to a clean, de-duplicated list
 *  while preserving the curator's order. */
export function toSkuList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') continue;
    const s = x.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * How many of a category's picked SKUs are still active products.
 *
 * Counted against the catalogue rather than just the array length: a SKU can be
 * discontinued or renamed after it was picked, and the admin should show what
 * the storefront will really render, not a stale list length.
 */
export async function countProducts(productSkus: unknown): Promise<number> {
  const skus = toSkuList(productSkus);
  if (!skus.length) return 0;
  return prisma.product.count({ where: { status: 'active', sku: { in: skus } } });
}
