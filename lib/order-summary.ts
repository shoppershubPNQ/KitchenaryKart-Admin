/**
 * Single source of truth for the order price breakdown on the invoice PDF,
 * admin order page and print view. Mirrors web/lib/order-summary.ts so every
 * surface shows IDENTICAL labels + numbers.
 *
 * Stored line prices are GST-INCLUSIVE. This backs the tax out per line and
 * presents the GST-compliant ladder:
 *
 *   Excluding GST Price (Net Price)  — ex-GST, before discount
 *   Discount (%)                     — coupon discount, as a percentage
 *   Net Value                        — ex-GST, AFTER discount (the GST base)
 *   GST (%)                          — charged on Net Value (discounted)
 *   Shipping Cost                    — flat fee, or 0 when free
 *   Net Payable Amount               — Net Value + GST + Shipping
 *
 * GST is computed on the DISCOUNTED net value. `netPayable` equals the
 * order's stored totalAmount (the binding charge), so nothing drifts.
 */
export interface SummaryInputItem {
  name: string;
  sku: string;
  hsnCode?: string | null;
  /** GST-inclusive line total (unitPrice × qty, incl. GST). */
  lineInclusive: number;
  quantity: number;
  taxPercent: number;
}

export interface SummaryLine {
  name: string;
  sku: string;
  hsnCode?: string | null;
  quantity: number;
  taxPercent: number;
  /** Ex-GST unit price. */
  unitNetPrice: number;
  /** Ex-GST line value before discount (unitNetPrice × qty). */
  lineNetPrice: number;
  /** Ex-GST discount allocated to this line. */
  lineDiscount: number;
  /** Ex-GST line value after discount. */
  lineNetValue: number;
  /** GST on the discounted line net value. */
  lineGst: number;
  /** lineNetValue + lineGst. */
  lineTotal: number;
}

export interface OrderSummary {
  netPrice: number;
  discountPct: number;
  discountAmount: number;
  netValue: number;
  gstAmount: number;
  gstRateLabel: string;
  shipping: number;
  /** Adjustment to reach a whole-rupee Net Payable (can be + or −). */
  roundOff: number;
  netPayable: number;
  lines: SummaryLine[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeOrderSummary(
  items: SummaryInputItem[],
  discountInclusive = 0,
  shipping = 0,
): OrderSummary {
  const inclusiveTotal = items.reduce((s, i) => s + i.lineInclusive, 0);
  const discountPct = inclusiveTotal > 0 ? (discountInclusive / inclusiveTotal) * 100 : 0;

  const lines: SummaryLine[] = items.map((i) => {
    const rate = i.taxPercent;
    const lineNetPrice = i.lineInclusive / (1 + rate / 100); // ex-GST before discount
    const lineNetValue = lineNetPrice * (1 - discountPct / 100); // ex-GST after discount
    const lineGst = lineNetValue * (rate / 100); // GST on discounted value
    const qty = i.quantity || 1;
    return {
      name: i.name,
      sku: i.sku,
      hsnCode: i.hsnCode,
      quantity: qty,
      taxPercent: rate,
      unitNetPrice: round2(lineNetPrice / qty),
      lineNetPrice: round2(lineNetPrice),
      lineDiscount: round2(lineNetPrice - lineNetValue),
      lineNetValue: round2(lineNetValue),
      lineGst: round2(lineGst),
      lineTotal: round2(lineNetValue + lineGst),
    };
  });

  const netPrice = round2(lines.reduce((s, l) => s + l.lineNetPrice, 0));
  const netValue = round2(lines.reduce((s, l) => s + l.lineNetValue, 0));
  const goodsGst = round2(lines.reduce((s, l) => s + l.lineGst, 0));
  const rates = [...new Set(items.map((i) => i.taxPercent))];
  const gstRateLabel = rates.length === 1 ? `${rates[0]}%` : '';

  // Shipping/freight is part of the taxable value (CGST Act s.15) — GST is
  // charged on (Net Value + Shipping), taxed at the order's single rate (or
  // 18% for a mixed-rate cart).
  const shippingRate = rates.length === 1 ? rates[0] : 18;
  const gstAmount = round2(goodsGst + shipping * (shippingRate / 100));

  // Round the final payable to a whole rupee; the difference is the
  // "Round Off" line (standard on Indian GST invoices).
  const exactPayable = round2(netValue + shipping + gstAmount);
  const netPayable = Math.round(exactPayable);

  return {
    netPrice,
    discountPct: round2(discountPct),
    discountAmount: round2(netPrice - netValue),
    netValue,
    gstAmount,
    gstRateLabel,
    shipping: round2(shipping),
    roundOff: round2(netPayable - exactPayable),
    netPayable,
    lines,
  };
}
