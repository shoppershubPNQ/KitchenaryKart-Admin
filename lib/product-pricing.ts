/**
 * Product-level GST / pricing breakdown for the admin listing.
 *
 * Mirrors the invoice convention in lib/order-summary.ts: the stored
 * `price` is GST-INCLUSIVE (the customer-facing selling price). We back the
 * tax out of it so the same numbers show on the invoice and the catalog:
 *
 *   Taxable value (Net) = price / (1 + rate/100)
 *   GST amount          = price − net
 *   CGST = SGST         = GST / 2   (intra-state supply, the common case)
 *
 * MRP is the pre-discount sticker; discount is MRP − selling price.
 */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ProductGst {
  /** GST rate %, e.g. 18. */
  rate: number;
  /** Selling price incl. GST (the stored `price`). */
  inclusive: number;
  /** Ex-GST taxable value. */
  net: number;
  /** Total GST amount (inclusive − net). */
  gst: number;
  /** CGST half of the GST (intra-state). */
  cgst: number;
  /** SGST half of the GST (intra-state). */
  sgst: number;
  /** MRP sticker price, or null when not set. */
  mrp: number | null;
  /** MRP − selling price (>= 0), or 0 when no MRP / no discount. */
  discountAmount: number;
  /** Discount as % of MRP. */
  discountPct: number;
}

export function computeProductGst(
  price: number,
  taxPercent: number,
  mrp: number | null = null,
): ProductGst {
  const rate = Number(taxPercent) || 0;
  const inclusive = Number(price) || 0;
  const net = rate > 0 ? inclusive / (1 + rate / 100) : inclusive;
  const gst = inclusive - net;
  const mrpNum = mrp != null ? Number(mrp) : null;
  const discountAmount = mrpNum && mrpNum > inclusive ? mrpNum - inclusive : 0;
  const discountPct = mrpNum && mrpNum > 0 ? (discountAmount / mrpNum) * 100 : 0;

  return {
    rate,
    inclusive: round2(inclusive),
    net: round2(net),
    gst: round2(gst),
    cgst: round2(gst / 2),
    sgst: round2(gst / 2),
    mrp: mrpNum,
    discountAmount: round2(discountAmount),
    discountPct: round2(discountPct),
  };
}
