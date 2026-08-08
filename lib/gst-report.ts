/**
 * GST Merchant Tax Report (MTR) generation.
 *
 * Produces one row per order item (matching Amazon Seller Central's
 * MTR-B2B / MTR-B2C exports). The admin downloads these monthly to
 * file GSTR-1 and reconcile with the books.
 *
 * Source of truth: orders with `paymentStatus = 'completed'` in the
 * selected period. Orders missing an invoice serial get one allocated
 * here so the report is GST-complete (no gaps, no orphans).
 */
import { prisma } from './db';
import {
  backfillSerialsForFinancialYear,
  formatInvoiceNumber,
  getFinancialYearBounds,
  getMonthBounds,
} from './invoice-serial';
import { detectStateFromAddress, GST_STATES } from './gst-states';
import { computeOrderSummary } from './order-summary';

export type GstReportType = 'b2b' | 'b2c' | 'all';

export interface GstReportFilters {
  /** "2026-27" — Indian financial year. */
  fy: string;
  /** 1-12 calendar month. Omit for the full FY. */
  month?: number;
  /** B2B = buyer has GSTIN; B2C = no GSTIN. */
  type: GstReportType;
}

export interface GstReportRow {
  orderId: number;
  orderNumber: string;
  invoiceNumber: string;
  invoiceDate: string;            // dd/mm/yyyy
  customerName: string;
  customerGstin: string;          // empty for B2C
  customerType: 'B2B' | 'B2C';
  productSku: string;
  productName: string;
  hsnCode: string;
  quantity: number;
  taxableValue: number;
  taxRate: number;                // e.g. 18
  cgst: number;
  sgst: number;
  igst: number;
  totalInvoiceValue: number;      // line total incl. tax
  placeOfSupplyName: string;
  placeOfSupplyCode: string;
  isInterState: 'Yes' | 'No';
  /** Fulfilment state of the order — delivered / shipped / processing /
   *  cancelled. The report only ever includes PAID orders, but "paid" and
   *  "not cancelled" are different things: an order can be paid and then
   *  cancelled before dispatch, and it would sit in this file looking like a
   *  normal sale. Surfaced so a cancelled line can be spotted and a credit
   *  note raised instead of it being filed as revenue. */
  orderStatus: string;
  /** Payment state, always 'completed' given the query filter — carried so the
   *  sheet is self-explanatory and the filter is auditable from the file. */
  paymentStatus: string;
  /** Coupon applied to the order, blank when none. */
  couponCode: string;
  /** This line's share of the order-level coupon discount (ex-GST), apportioned
   *  by value. Shares across an order add back to the order's discount. */
  lineDiscount: number;
  /** Ex-GST line value BEFORE the discount. `taxableValue` above is the figure
   *  that gets filed (after discount); this is kept so the deduction is
   *  visible and the sheet can be audited without re-deriving it. */
  grossTaxableValue: number;
  /** 'Goods' or 'Shipping'. Shipping is billed to the customer with GST, so it
   *  is an outward supply and gets its own row under SAC 9965. */
  lineType: 'Goods' | 'Shipping';
  /** Unit Quantity Code for the GSTR-1 HSN summary. NOS for goods, OTH for
   *  freight — we do not store per-product units, so goods default to NOS. */
  uqc: string;
  /** Compensation cess. Always 0 — nothing in this catalogue attracts it —
   *  but GSTR-1 expects the column, so it is emitted rather than omitted. */
  cess: number;
  /** Reverse charge applicability. 'N' throughout: these are ordinary B2B/B2C
   *  outward supplies, not notified reverse-charge categories. */
  reverseCharge: 'Y' | 'N';
  /** GSTR-1 invoice type. 'Regular' — no SEZ, export or deemed-export sales. */
  invoiceType: string;
  /** Invoice-level rounding to a whole rupee, carried on the order's FIRST row
   *  so the rows sum to the invoice value exactly. 0 on the others. */
  roundOff: number;
  /** The order's whole invoice value (what the customer paid). Repeated on each
   *  of the order's rows, as MTR exports do, so invoice-level totals can be
   *  taken without re-summing the lines. */
  orderInvoiceValue: number;
  /** Freight on this invoice, stated BOTH ways and repeated on every row of the
   *  order. `shippingCost` is stored ex-GST and the customer is charged it plus
   *  GST, so one figure alone is ambiguous: the ex-GST amount is what goes in
   *  the return, the incl-GST amount is what ties back to the money collected. */
  shippingExGst: number;
  shippingGst: number;
  shippingInclGst: number;
}

export interface GstReportSummary {
  rows: number;
  orders: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalInvoiceValue: number;
  /** Orders in this report that are PAID but CANCELLED. Normally 0. When it is
   *  not, those lines are sitting in the file looking like ordinary sales, and
   *  a credit note is due rather than the invoice being filed as revenue —
   *  so it is surfaced before the file is opened, not after filing. */
  cancelledOrders: number;
  /** Rupee value of those cancelled lines, so the size of the problem is
   *  visible without filtering the sheet. */
  cancelledValue: number;
  /** Coupon discount deducted across the period (ex-GST), and the pre-discount
   *  taxable total it was deducted from. `taxableValue` above is already NET. */
  discountTotal: number;
  grossTaxableValue: number;
  /** Freight billed in the period, stated both ways — previously missing from
   *  the return entirely. `shippingTaxable` is the ex-GST amount included in
   *  `taxableValue`; `shippingInclGst` is what customers actually paid. */
  shippingTaxable: number;
  shippingGst: number;
  shippingInclGst: number;
  /** Invoice-level rounding across the period. */
  roundOff: number;
  /** Sum of the orders' own stored totals. `totalInvoiceValue` above is built
   *  from the report's own lines, so the two agreeing is proof the report
   *  reconciles to what the customer was actually charged. */
  ordersTotalAmount: number;
  /** ordersTotalAmount − totalInvoiceValue. Must be ~0; anything else means the
   *  report and the invoices have drifted apart. */
  reconciliationGap: number;
}

export interface GstReportResult {
  filters: GstReportFilters;
  rangeStart: Date;
  rangeEnd: Date;
  rows: GstReportRow[];
  summary: GstReportSummary;
}

const SELLER_STATE_CODE = '27'; // Maharashtra — KK's registered place of business

export async function generateGstReport(filters: GstReportFilters): Promise<GstReportResult> {
  // 1. Make sure every paid order in the FY has an invoice serial.
  //    Allocation is chronological so serials line up with order dates.
  await backfillSerialsForFinancialYear(filters.fy);

  // 2. Compute the date range
  const { start, end } = filters.month
    ? getMonthBounds(filters.fy, filters.month)
    : getFinancialYearBounds(filters.fy);

  // 3. Fetch all paid orders in range that now have an invoice number,
  //    plus items + customer for HSN + GSTIN lookups.
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: start, lt: end },
      paymentStatus: 'completed',
      invoiceSerial: { not: null },
      invoiceFinancialYear: filters.fy,
    },
    include: {
      items: { include: { product: true } },
      customer: true,
    },
    orderBy: { invoiceSerial: 'asc' },
  });

  // HSN fallback: an order item's `product` relation is null when its
  // productId was never linked (e.g. variant SKUs). HSN is a product attribute,
  // so look it up by the item's stored SKU. Cheap single query, keyed by sku.
  const skuHsn = new Map<string, string>();
  for (const p of await prisma.product.findMany({ select: { sku: true, hsnCode: true } })) {
    if (p.hsnCode) skuHsn.set(p.sku, p.hsnCode);
  }

  // Variant SKUs resolved through the VARIANT TABLE, not by string surgery.
  //
  // The old fallback assumed a variant sku is "<parentSku>-<suffix>" and
  // trimmed at the last hyphen. That is not this catalogue's convention —
  // skuSuffix holds a COMPLETE, independent sku (KKA0009-BBQRERB belongs to
  // parent KKA0008-BBQRERS), so the trim produced a sku that does not exist and
  // the line was filed with a BLANK HSN. GSTR-1's HSN summary needs it.
  const variantHsn = new Map<string, string>();
  for (const v of await prisma.productVariant.findMany({
    where: { skuSuffix: { not: null } },
    select: { skuSuffix: true, product: { select: { hsnCode: true } } },
  })) {
    if (v.skuSuffix && v.product?.hsnCode) variantHsn.set(v.skuSuffix, v.product.hsnCode);
  }

  const hsnForSku = (sku: string): string => {
    if (skuHsn.has(sku)) return skuHsn.get(sku)!;
    if (variantHsn.has(sku)) return variantHsn.get(sku)!;
    // Last resort: some legacy skus really are "<parentSku>-<suffix>".
    const cut = sku.lastIndexOf('-');
    if (cut > 0 && skuHsn.has(sku.slice(0, cut))) return skuHsn.get(sku.slice(0, cut))!;
    return '';
  };

  const rows: GstReportRow[] = [];

  for (const order of orders) {
    // Match the invoice generator (lib/invoice-build.ts): a GSTIN entered at
    // checkout is stored on the order itself and must win over the profile's.
    const gstin = (order.customerGstin?.trim() || order.customer?.gstNumber?.trim()) ?? '';
    const isB2B = !!gstin;
    if (filters.type === 'b2b' && !isB2B) continue;
    if (filters.type === 'b2c' && isB2B) continue;

    // Per-line breakdown — taxable value, tax, place of supply
    const detected =
      detectStateFromAddress(order.shippingAddress) ??
      detectStateFromAddress(order.customer?.billingAddress) ??
      GST_STATES.find((s) => s.code === SELLER_STATE_CODE) ??
      null;
    const placeOfSupplyName = detected?.name ?? '';
    const placeOfSupplyCode = detected?.code ?? '';
    const isInterState = !!detected && detected.code !== SELLER_STATE_CODE;

    const invoiceNumber = formatInvoiceNumber(
      order.invoiceFinancialYear!,
      order.invoiceSerial!,
    );
    const invoiceDate = order.createdAt.toLocaleDateString('en-IN');

    // THE SAME breakdown the invoice PDF renders. Previously this file did its
    // own arithmetic on the gross line total, which disagreed with the invoice
    // the customer actually received in two ways:
    //
    //   * the coupon discount was never netted off, so taxable value and GST
    //     were BOTH overstated (July: Rs 7,986 taxable / Rs 1,218 GST);
    //   * shipping was omitted entirely, even though GST is charged on it and
    //     it forms part of the taxable value under CGST Act s.15 (July:
    //     Rs 2,150 taxable / Rs 387 GST simply missing from the return).
    //
    // GSTR-1 has to match the issued invoice, so the report now derives from
    // the same helper rather than re-deriving the numbers a second way.
    const breakdown = computeOrderSummary(
      order.items.map((it) => ({
        name: it.productName || '',
        sku: it.productSku || '',
        hsnCode: it.product?.hsnCode ?? null,
        lineInclusive: Number(it.lineTotal),
        quantity: it.quantity,
        taxPercent: Number(it.taxPercent),
      })),
      Number(order.discountAmount || 0),
      Number(order.shippingCost || 0),
    );

    // Rows for THIS order are collected first so the round-off can be derived
    // from what the customer was actually charged, rather than re-deriving it
    // with Math.round. Orders placed before whole-rupee rounding was introduced
    // were charged half-rupee totals, and a fresh Math.round disagrees with them
    // by 50 paise — which showed up as the report failing to reconcile. Taking
    // the difference against the stored total makes every invoice tie exactly,
    // historical or not, and the round-off column then states the truth.
    const orderRows: GstReportRow[] = [];

    // Freight both ways, resolved once and carried on EVERY row of the invoice.
    // `shippingCost` is stored EX-GST and the customer is charged it plus GST,
    // so quoting only one of the two is ambiguous — an accountant reading the
    // sheet needs the taxable figure for the return and the gross figure to tie
    // back to the amount collected.
    const shipRates = [...new Set(order.items.map((i) => Number(i.taxPercent)))];
    const shipRateForOrder = shipRates.length === 1 ? shipRates[0] : 18;
    const shippingExGst = round2(Number(order.shippingCost || 0));
    const shippingGstAmt = round2(shippingExGst * (shipRateForOrder / 100));
    const shippingInclGst = round2(shippingExGst + shippingGstAmt);

    order.items.forEach((it, idx) => {
      const line = breakdown.lines[idx];
      const taxPercent = line.taxPercent;
      const taxableValue = line.lineNetValue;   // ex-GST, AFTER discount
      const totalTax = line.lineGst;            // GST on the discounted value
      const cgst = isInterState ? 0 : round2(totalTax / 2);
      const sgst = isInterState ? 0 : round2(totalTax / 2);
      const igst = isInterState ? totalTax : 0;
      const lineTotal = line.lineTotal;
      const lineDiscount = line.lineDiscount;

      orderRows.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        invoiceNumber,
        invoiceDate,
        customerName: order.customerName || order.customer?.name || '',
        customerGstin: gstin,
        customerType: isB2B ? 'B2B' : 'B2C',
        productSku: it.productSku || '',
        productName: it.productName || '',
        hsnCode: it.product?.hsnCode || hsnForSku(it.productSku || ''),
        quantity: it.quantity,
        taxableValue,
        taxRate: taxPercent,
        cgst,
        sgst,
        igst,
        totalInvoiceValue: lineTotal,
        placeOfSupplyName,
        placeOfSupplyCode,
        isInterState: isInterState ? 'Yes' : 'No',
        couponCode: order.couponCode ?? '',
        lineDiscount,
        grossTaxableValue: line.lineNetPrice,
        lineType: 'Goods',
        uqc: 'NOS',
        cess: 0,
        reverseCharge: 'N',
        invoiceType: 'Regular',
        roundOff: 0, // set below, from the amount actually charged
        shippingExGst,
        shippingGst: shippingGstAmt,
        shippingInclGst,
        orderInvoiceValue: breakdown.netPayable,
        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,
      });
    });

    // Shipping is a separate line on the invoice, so it is a separate line
    // here. It was previously absent from the return altogether even though
    // GST is collected on it — the customer is charged it, so it is an outward
    // supply and belongs in GSTR-1.
    //
    // SAC 9965 (goods transport). Rate follows the order's goods rate, matching
    // computeOrderSummary and the composite-supply rule: freight incidental to
    // a supply of goods takes the rate of the principal supply.
    const shipping = round2(Number(order.shippingCost || 0));
    if (shipping > 0) {
      const rates = [...new Set(order.items.map((i) => Number(i.taxPercent)))];
      const shipRate = rates.length === 1 ? rates[0] : 18;
      const shipGst = round2(shipping * (shipRate / 100));
      orderRows.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        invoiceNumber,
        invoiceDate,
        customerName: order.customerName || order.customer?.name || '',
        customerGstin: gstin,
        customerType: isB2B ? 'B2B' : 'B2C',
        productSku: '',
        productName: 'Shipping / Freight',
        hsnCode: '9965',
        quantity: 1,
        taxableValue: shipping,
        taxRate: shipRate,
        cgst: isInterState ? 0 : round2(shipGst / 2),
        sgst: isInterState ? 0 : round2(shipGst / 2),
        igst: isInterState ? shipGst : 0,
        totalInvoiceValue: round2(shipping + shipGst),
        placeOfSupplyName,
        placeOfSupplyCode,
        isInterState: isInterState ? 'Yes' : 'No',
        couponCode: order.couponCode ?? '',
        lineDiscount: 0,               // the coupon applies to goods, not freight
        grossTaxableValue: shipping,
        lineType: 'Shipping',
        uqc: 'OTH',
        cess: 0,
        reverseCharge: 'N',
        invoiceType: 'Regular',
        roundOff: 0,
        shippingExGst,
        shippingGst: shippingGstAmt,
        shippingInclGst,
        orderInvoiceValue: breakdown.netPayable,
        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,
      });
    }

    // Tie this invoice to the rupee. Round-off is the difference between what
    // the customer was CHARGED and what these lines add up to — not a fresh
    // Math.round, which disagrees by 50 paise on orders placed before
    // whole-rupee rounding existed and made the whole month look unreconciled.
    const charged = round2(Number(order.totalAmount));
    const lineSum = round2(orderRows.reduce((s, r) => s + r.totalInvoiceValue, 0));
    if (orderRows.length) {
      orderRows[0].roundOff = round2(charged - lineSum);
      for (const r of orderRows) r.orderInvoiceValue = charged;
    }
    rows.push(...orderRows);
  }

  // 4. Reconciliation totals
  const summary: GstReportSummary = {
    rows: rows.length,
    orders: new Set(rows.map((r) => r.orderId)).size,
    taxableValue: round2(rows.reduce((s, r) => s + r.taxableValue, 0)),
    cgst: round2(rows.reduce((s, r) => s + r.cgst, 0)),
    sgst: round2(rows.reduce((s, r) => s + r.sgst, 0)),
    igst: round2(rows.reduce((s, r) => s + r.igst, 0)),
    totalInvoiceValue: round2(rows.reduce((s, r) => s + r.totalInvoiceValue, 0)),
    cancelledOrders: new Set(
      rows.filter((r) => r.orderStatus === 'cancelled').map((r) => r.orderId),
    ).size,
    cancelledValue: round2(
      rows.filter((r) => r.orderStatus === 'cancelled')
        .reduce((s, r) => s + r.totalInvoiceValue, 0),
    ),
    discountTotal: round2(rows.reduce((s, r) => s + r.lineDiscount, 0)),
    grossTaxableValue: round2(rows.reduce((s, r) => s + r.grossTaxableValue, 0)),
    shippingTaxable: round2(
      rows.filter((r) => r.lineType === 'Shipping').reduce((s, r) => s + r.taxableValue, 0),
    ),
    shippingGst: round2(
      rows.filter((r) => r.lineType === 'Shipping')
        .reduce((s, r) => s + r.cgst + r.sgst + r.igst, 0),
    ),
    shippingInclGst: round2(
      rows.filter((r) => r.lineType === 'Shipping')
        .reduce((s, r) => s + r.totalInvoiceValue, 0),
    ),
    roundOff: round2(rows.reduce((s, r) => s + r.roundOff, 0)),
    ordersTotalAmount: round2(
      orders
        .filter((o) => new Set(rows.map((r) => r.orderId)).has(o.id))
        .reduce((s, o) => s + Number(o.totalAmount), 0),
    ),
    reconciliationGap: 0, // filled below, once both sides are known
  };
  // Lines + round-off must add up to what the customer was charged. If this is
  // not ~0 the report has drifted from the invoices and must not be filed.
  summary.reconciliationGap = round2(
    summary.ordersTotalAmount - (summary.totalInvoiceValue + summary.roundOff),
  );

  return { filters, rangeStart: start, rangeEnd: end, rows, summary };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Header labels exactly as they should appear in xlsx/csv exports. */
export const REPORT_COLUMNS: Array<{ key: keyof GstReportRow; label: string }> = [
  { key: 'orderId', label: 'Order ID' },
  { key: 'orderNumber', label: 'Order Number' },
  { key: 'invoiceNumber', label: 'Invoice Number' },
  { key: 'invoiceDate', label: 'Invoice Date' },
  { key: 'customerType', label: 'Customer Type' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'customerGstin', label: 'Customer GSTIN' },
  { key: 'productSku', label: 'Product SKU' },
  { key: 'productName', label: 'Product Name' },
  { key: 'hsnCode', label: 'HSN Code' },
  { key: 'lineType', label: 'Line Type' },
  { key: 'uqc', label: 'UQC' },
  { key: 'quantity', label: 'Quantity' },
  // Gross → discount → taxable, in the order an auditor reads them.
  { key: 'grossTaxableValue', label: 'Taxable Value (Before Discount)' },
  { key: 'couponCode', label: 'Coupon' },
  { key: 'lineDiscount', label: 'Discount' },
  { key: 'taxableValue', label: 'Taxable Value' },
  { key: 'taxRate', label: 'Tax Rate %' },
  { key: 'cgst', label: 'CGST' },
  { key: 'sgst', label: 'SGST' },
  { key: 'igst', label: 'IGST' },
  { key: 'cess', label: 'Cess' },
  { key: 'totalInvoiceValue', label: 'Line Total' },
  { key: 'roundOff', label: 'Round Off' },
  { key: 'orderInvoiceValue', label: 'Invoice Value' },
  // Freight stated both ways — the ex-GST figure is what is filed, the
  // incl-GST figure is what the customer was charged.
  { key: 'shippingExGst', label: 'Shipping (Excl. GST)' },
  { key: 'shippingGst', label: 'Shipping GST' },
  { key: 'shippingInclGst', label: 'Shipping (Incl. GST)' },
  { key: 'placeOfSupplyName', label: 'Place of Supply' },
  { key: 'placeOfSupplyCode', label: 'State Code' },
  { key: 'isInterState', label: 'Inter-state' },
  { key: 'reverseCharge', label: 'Reverse Charge' },
  { key: 'invoiceType', label: 'Invoice Type' },
  // Last two on purpose: the GST-relevant columns stay in the familiar MTR
  // order, and these sit at the end where they are easy to filter on without
  // shifting anything the accountant already reads by position.
  { key: 'orderStatus', label: 'Order Status' },
  { key: 'paymentStatus', label: 'Payment Status' },
];
