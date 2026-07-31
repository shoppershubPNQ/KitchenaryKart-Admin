/**
 * Single source of truth for the zone×weight delivery charge.
 *
 * Used by BOTH the binding checkout route (the amount the customer pays) and
 * the public shipping-quote endpoint (what the storefront shows before pay),
 * so the displayed and charged amounts can never drift. Weights are read from
 * the DB (parent product; variants share the parent's weight), the zone from
 * the destination state, and the rest from the engine in shipping-zones.ts.
 */
import { prisma } from './db';
import { detectStateFromAddress } from './gst-states';
import { zoneForState, orderWeightGrams, zoneWeightShipping, type Zone } from './shipping-zones';

export interface ShippingResult {
  shippingCost: number;
  zone: Zone;
  totalGrams: number;
  stateName: string | null;
}

export async function computeShipping(
  items: Array<{ sku: string; quantity: number }>,
  opts: { state?: string | null; shippingAddress?: string | null; orderValueAfterDiscount: number },
): Promise<ShippingResult> {
  const skus = items.map((i) => i.sku);

  // Resolve a weight string per sku. A variant now carries its OWN weight
  // (sizes of one product differ — a 24" whisk is 360g vs 174g for the 10"),
  // so prefer that and fall back to the parent only when it's blank.
  const [products, variants] = await Promise.all([
    prisma.product.findMany({ where: { sku: { in: skus } }, select: { sku: true, weight: true } }),
    prisma.productVariant.findMany({
      where: { skuSuffix: { in: skus } },
      select: { skuSuffix: true, weight: true, product: { select: { weight: true } } },
    }),
  ]);
  const weightBySku = new Map<string, string | null>();
  for (const p of products) weightBySku.set(p.sku, p.weight);
  for (const v of variants) if (v.skuSuffix) weightBySku.set(v.skuSuffix, v.weight ?? v.product?.weight ?? null);

  const totalGrams = orderWeightGrams(
    items.map((i) => ({ weight: weightBySku.get(i.sku) ?? null, quantity: i.quantity })),
  );

  // Resolve the destination state through detectStateFromAddress (handles full
  // names AND aliases like "MH"/"Tamilnadu") so the QUOTE (storefront sends the
  // raw address.state) and the BINDING charge (full shippingAddress string)
  // always land on the SAME zone — no display-vs-charge drift.
  const detected =
    detectStateFromAddress(opts.state ?? '') ||
    detectStateFromAddress(opts.shippingAddress ?? '');
  const stateName = detected?.name ?? null;
  const zone = zoneForState(stateName);
  const shippingCost = zoneWeightShipping(zone, totalGrams, opts.orderValueAfterDiscount);

  return { shippingCost, zone, totalGrams, stateName };
}
