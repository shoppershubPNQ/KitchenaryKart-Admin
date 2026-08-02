/**
 * The commercial terms of the KitchenaryKart ↔ Hotelic Essentials link.
 *
 * The two catalogues are priced for different buyers, so money does not cross
 * unchanged. Inbound (Hotelic Essentials → here), a trade listing is re-priced
 * for retail:
 *
 *   1. add 30% to the trade figure
 *   2. add the GST that figure excludes
 *
 * The order is irrelevant — both steps are multiplications — so the result is
 * `trade × 1.30 × (1 + rate/100)` either way. The rule in the partner panel is
 * the mirror: −30%, then GST stripped out.
 *
 * NOTE these are NOT inverses. 1.30 up then 0.70 down lands at 0.91 of where it
 * started, so a listing round-tripped through both panels loses 9% each lap.
 * The loop guard (neither panel republishes what it imported from the other) is
 * what stops that happening on its own, but it is worth knowing before anyone
 * re-imports something by hand.
 *
 * Both numbers live here and nowhere else — change the rate and every price,
 * MRP, variant and preview diff moves with it.
 */

/** Retail price as a multiple of the partner's trade price. 1.30 = +30%. */
export const INBOUND_PRICE_FACTOR = 1.3;

/**
 * Applied when the partner sends no rate at all. An explicit 0 is honoured as
 * genuinely zero-rated — only "unknown" falls back, and 18% is the default this
 * catalogue already carries on every product.
 */
export const DEFAULT_GST_PERCENT = 18;

/** The rate to use for a listing: theirs when stated, the default when not. */
export function effectiveGstPercent(taxPercent: number | null | undefined): number {
  if (taxPercent === null || taxPercent === undefined) return DEFAULT_GST_PERCENT;
  const rate = Number(taxPercent);
  if (!Number.isFinite(rate) || rate < 0) return DEFAULT_GST_PERCENT;
  return rate;
}

/**
 * A partner's GST-exclusive trade figure → our GST-inclusive retail figure.
 * Rounded to paise, because the column is Decimal(10,2).
 */
export function toRetailPrice(tradeRupees: number, taxPercent: number | null | undefined): number {
  const net = Number(tradeRupees);
  if (!Number.isFinite(net) || net <= 0) return 0;

  const rate = effectiveGstPercent(taxPercent);
  const marked = net * INBOUND_PRICE_FACTOR;

  // A 0% rate multiplies by 1, so zero-rated goods only take the markup.
  return Math.round(marked * (1 + rate / 100) * 100) / 100;
}

/** Human-readable summary of what the rule did, for the review diff. */
export function retailPriceNote(taxPercent: number | null | undefined): string {
  const rate = effectiveGstPercent(taxPercent);
  return rate > 0
    ? `Their trade price plus 30%, then plus ${rate}% GST.`
    : 'Their trade price plus 30% (zero-rated, so no GST added).';
}
