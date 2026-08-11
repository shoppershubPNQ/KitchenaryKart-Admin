/**
 * Single source of truth for turning a sku into an authoritative price.
 *
 * A sku can be a parent product OR a variant (`skuSuffix`). Variant skus are
 * NOT in the products table — resolving only against `product` silently yields
 * "no such product", which is how the manual-order route ended up pricing
 * variants at ₹0 under the name "Unknown item". `skuSuffix` is a COMPLETE,
 * independent sku, never `<parent>-<suffix>`, so it can only be looked up
 * directly (see Part 16, lesson 5).
 *
 * Used by the storefront checkout (the binding charge), the manual-order route
 * and the admin quote endpoint, so a phone order and a website order for the
 * same item can never be priced differently.
 *
 * Prices returned here are GST-INCLUSIVE, matching how they are stored and
 * displayed. Back the tax out with computeOrderSummary — never add GST on top.
 */
import { prisma } from './db';

export interface ResolvedOrderItem {
  productId: number | null;
  variantId: number | null;
  name: string;
  /** GST-inclusive unit price. */
  price: number;
  taxPercent: number;
  stock: number;
}

export interface ResolveOptions {
  /**
   * Append the variant's own value to the name ("Whisk — 24\""). Manual orders
   * want it so the invoice names the size. The storefront checkout leaves it
   * OFF so stored order-item names stay byte-identical to what it has always
   * written — changing them is a separate decision, not a side effect of
   * sharing this helper.
   */
  qualifyVariantNames?: boolean;
}

export async function resolveOrderItems(
  skus: string[],
  opts: ResolveOptions = {},
): Promise<Map<string, ResolvedOrderItem>> {
  const unique = [...new Set(skus.filter(Boolean))];
  if (!unique.length) return new Map();

  const [products, variants] = await Promise.all([
    prisma.product.findMany({
      where: { sku: { in: unique } },
      select: { id: true, sku: true, name: true, price: true, taxPercent: true, stock: true },
    }),
    prisma.productVariant.findMany({
      where: { skuSuffix: { in: unique } },
      select: {
        id: true,
        skuSuffix: true,
        stock: true,
        priceModifier: true,
        price: true,
        variantValue: true,
        product: { select: { id: true, name: true, price: true, taxPercent: true } },
      },
    }),
  ]);

  const resolved = new Map<string, ResolvedOrderItem>();
  for (const p of products) {
    resolved.set(p.sku, {
      productId: p.id,
      variantId: null,
      name: p.name,
      price: Number(p.price),
      taxPercent: Number(p.taxPercent),
      stock: p.stock,
    });
  }
  // Variants are set AFTER parents so a sku that somehow exists as both
  // resolves to the variant — the more specific record.
  for (const v of variants) {
    if (!v.skuSuffix) continue;
    const qualifier = (v.variantValue || '').trim();
    resolved.set(v.skuSuffix, {
      productId: v.product?.id ?? null,
      variantId: v.id,
      // Name the size, otherwise every size of one product reads identically on
      // the order and the invoice.
      name:
        opts.qualifyVariantNames && qualifier
          ? `${v.product?.name ?? v.skuSuffix} — ${qualifier}`
          : (v.product?.name ?? v.skuSuffix),
      // Prefer the variant's own absolute price; fall back to parent+modifier
      // for any variant without its own price yet. This is the BINDING charge —
      // it MUST match the storefront's displayed variant price.
      price: v.price != null ? Number(v.price) : Number(v.product?.price ?? 0) + Number(v.priceModifier ?? 0),
      taxPercent: Number(v.product?.taxPercent ?? 18),
      stock: v.stock,
    });
  }
  return resolved;
}
