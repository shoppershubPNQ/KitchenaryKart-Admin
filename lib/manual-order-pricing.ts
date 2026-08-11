/**
 * Prices a manual (phone / WhatsApp) order EXACTLY the way the website prices
 * a checkout, so the same basket to the same address costs the same money
 * whichever door it comes through.
 *
 * What this replaced: the manual-order route did its own arithmetic. It added
 * GST **on top** of a price that is already GST-inclusive (an ~18% overcharge),
 * took freight as a number the operator typed with no GST on it at all, and
 * looked skus up only in `product` — so any variant priced at ₹0 as
 * "Unknown item". Same shape of bug, and same fix, as the GST report in
 * Part 16: stop having a second source of truth.
 *
 * The ladder, all through shared helpers:
 *   resolveOrderItems   sku (parent OR variant) -> authoritative inclusive price
 *   computeShipping     zone x weight freight for the destination
 *   computeOrderSummary backs GST out, taxes the freight, rounds the payable
 */
import { prisma } from './db';
import { resolveOrderItems } from './order-items';
import { computeShipping } from './shipping-compute';
import { computeOrderSummary, type OrderSummary } from './order-summary';

export interface ManualOrderItemInput {
  productId?: number;
  sku?: string;
  quantity: number;
  /** GST-INCLUSIVE negotiated override. Omit to use the catalogue price. */
  unitPrice?: number;
  taxPercent?: number;
}

export interface ManualOrderPricingInput {
  shippingAddress?: string | null;
  /** Ex-GST freight override. Omit for the automatic zone x weight charge. */
  shippingCost?: number;
  /** GST-inclusive discount in rupees. */
  discountAmount?: number;
  items: ManualOrderItemInput[];
}

export interface ManualOrderLine {
  productId: number | null;
  variantId: number | null;
  productName: string;
  productSku: string;
  /** GST-inclusive unit price. */
  unitPrice: number;
  quantity: number;
  taxPercent: number;
  /** GST-inclusive line total. */
  lineTotal: number;
  /** True when the operator overrode the catalogue price. */
  priceOverridden: boolean;
}

export interface ManualOrderPricing {
  lines: ManualOrderLine[];
  summary: OrderSummary;
  /** Ex-GST freight actually applied. */
  shippingCost: number;
  /** False when the operator supplied their own freight figure. */
  shippingAuto: boolean;
  /** Zone / weight the automatic charge came from — for showing the operator. */
  shippingZone: string | null;
  shippingGrams: number | null;
  shippingState: string | null;
  /** The rate freight was taxed at (the order's single rate, or 18% if mixed). */
  shippingRate: number;
}

/** Thrown for input the admin can fix — surfaced as a 400, not a 500. */
export class ManualOrderPricingError extends Error {}

export async function priceManualOrder(
  input: ManualOrderPricingInput,
): Promise<ManualOrderPricing> {
  if (!input.items?.length) throw new ManualOrderPricingError('Add at least one item');

  // Items may arrive by sku (typed / scanned) or by productId (picked in the
  // UI). Resolve both to the same authoritative record.
  const skus = input.items.map((i) => i.sku).filter((s): s is string => !!s);
  const ids = input.items.filter((i) => !i.sku && i.productId).map((i) => i.productId!);

  const [bySku, byIdRows] = await Promise.all([
    resolveOrderItems(skus, { qualifyVariantNames: true }),
    ids.length
      ? prisma.product.findMany({
          where: { id: { in: [...new Set(ids)] } },
          select: { id: true, sku: true, name: true, price: true, taxPercent: true, stock: true },
        })
      : Promise.resolve([]),
  ]);
  const byId = new Map(byIdRows.map((p) => [p.id, p]));

  const lines: ManualOrderLine[] = [];
  const unresolved: string[] = [];

  for (const it of input.items) {
    let productId: number | null = null;
    let variantId: number | null = null;
    let sku = it.sku ?? '';
    let name = '';
    let dbPrice = 0;
    let dbTax = 18;

    const hit = it.sku ? bySku.get(it.sku) : undefined;
    if (hit) {
      productId = hit.productId;
      variantId = hit.variantId;
      name = hit.name;
      dbPrice = hit.price;
      dbTax = hit.taxPercent;
    } else if (it.productId && byId.has(it.productId)) {
      const p = byId.get(it.productId)!;
      productId = p.id;
      sku = p.sku;
      name = p.name;
      dbPrice = Number(p.price);
      dbTax = Number(p.taxPercent);
    } else {
      unresolved.push(it.sku || `#${it.productId ?? '?'}`);
      continue;
    }

    const unitPrice = it.unitPrice ?? dbPrice;
    const taxPercent = it.taxPercent ?? dbTax;
    lines.push({
      productId,
      variantId,
      productName: name,
      productSku: sku,
      unitPrice,
      quantity: it.quantity,
      taxPercent,
      lineTotal: unitPrice * it.quantity,
      priceOverridden: it.unitPrice != null && it.unitPrice !== dbPrice,
    });
  }

  // Refuse rather than invent a price. Silently pricing an unknown sku at ₹0 is
  // how "Unknown item" orders were created.
  if (unresolved.length) {
    throw new ManualOrderPricingError(
      `These items could not be found in the catalogue: ${unresolved.join(', ')}`,
    );
  }

  const subtotalInclusive = lines.reduce((s, l) => s + l.lineTotal, 0);
  const discount = Math.min(input.discountAmount ?? 0, subtotalInclusive);
  const afterDiscount = Math.max(0, subtotalInclusive - discount);

  // Freight: the same zone x weight engine the website quotes from, unless the
  // operator deliberately overrode it.
  let shippingCost = input.shippingCost;
  let shippingAuto = false;
  let shippingZone: string | null = null;
  let shippingGrams: number | null = null;
  let shippingState: string | null = null;
  if (shippingCost == null) {
    const q = await computeShipping(
      lines.map((l) => ({ sku: l.productSku, quantity: l.quantity })),
      { shippingAddress: input.shippingAddress ?? null, orderValueAfterDiscount: afterDiscount },
    );
    shippingCost = q.shippingCost;
    shippingAuto = true;
    shippingZone = q.zone;
    shippingGrams = q.totalGrams;
    shippingState = q.stateName;
  }

  // computeOrderSummary is the SAME helper the invoice PDF, the admin order
  // page and the GST report use. Its netPayable IS the binding total — do not
  // recompute it a second way here.
  const summary = computeOrderSummary(
    lines.map((l) => ({
      name: l.productName,
      sku: l.productSku,
      lineInclusive: l.lineTotal,
      quantity: l.quantity,
      taxPercent: l.taxPercent,
    })),
    discount,
    shippingCost,
  );

  const rates = [...new Set(lines.map((l) => l.taxPercent))];
  const shippingRate = rates.length === 1 ? rates[0] : 18;

  return {
    lines,
    summary,
    shippingCost,
    shippingAuto,
    shippingZone,
    shippingGrams,
    shippingState,
    shippingRate,
  };
}
