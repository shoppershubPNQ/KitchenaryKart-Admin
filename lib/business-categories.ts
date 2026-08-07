/**
 * Business-category membership.
 *
 * A business category ("Pizza Equipment") cross-cuts the product taxonomy, so
 * membership is computed, not stored on the product:
 *
 *     (active products whose subcategory is in `subcategories`)
 *   + (products whose sku is in `productSkus`)
 *   - (products whose sku is in `excludeSkus`)
 *
 * `excludeSkus` wins over both, so a curator can always drop something the
 * subcategory rule wrongly pulled in.
 *
 * This lives in one place and is used by BOTH the admin preview and the
 * storefront page — if the two computed membership separately they would drift
 * and the admin would show a count the site does not match.
 */
import { prisma } from '@/lib/db';

export type BusinessCategoryRules = {
  subcategories: string[];
  productSkus: string[];
  excludeSkus: string[];
};

/** Json columns come back as `unknown`; coerce to a clean string[]. */
export function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
}

export function rulesOf(row: {
  subcategories: unknown;
  productSkus: unknown;
  excludeSkus: unknown;
}): BusinessCategoryRules {
  return {
    subcategories: toStringArray(row.subcategories),
    productSkus: toStringArray(row.productSkus),
    excludeSkus: toStringArray(row.excludeSkus),
  };
}

/**
 * Prisma `where` fragment selecting the products in a business category.
 * Returns null when the category has no rule at all — the caller should treat
 * that as "empty" rather than running a query that would match everything.
 */
export function whereForRules(rules: BusinessCategoryRules) {
  const or: any[] = [];
  if (rules.subcategories.length) or.push({ subcategory: { in: rules.subcategories } });
  if (rules.productSkus.length) or.push({ sku: { in: rules.productSkus } });
  if (!or.length) return null;

  const where: any = { status: 'active', OR: or };
  if (rules.excludeSkus.length) where.sku = { notIn: rules.excludeSkus };
  return where;
}

/** How many active products a category currently resolves to. */
export async function countProducts(rules: BusinessCategoryRules): Promise<number> {
  const where = whereForRules(rules);
  if (!where) return 0;
  return prisma.product.count({ where });
}
