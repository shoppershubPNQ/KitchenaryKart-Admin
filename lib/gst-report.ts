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
}

export interface GstReportSummary {
  rows: number;
  orders: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalInvoiceValue: number;
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

  const rows: GstReportRow[] = [];

  for (const order of orders) {
    const gstin = order.customer?.gstNumber?.trim() ?? '';
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

    for (const it of order.items) {
      const taxPercent = Number(it.taxPercent);
      const lineTotal = Number(it.lineTotal);
      const taxableValue = +(lineTotal / (1 + taxPercent / 100)).toFixed(2);
      const totalTax = +(lineTotal - taxableValue).toFixed(2);
      const cgst = isInterState ? 0 : +(totalTax / 2).toFixed(2);
      const sgst = isInterState ? 0 : +(totalTax / 2).toFixed(2);
      const igst = isInterState ? totalTax : 0;

      rows.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        invoiceNumber,
        invoiceDate,
        customerName: order.customerName || order.customer?.name || '',
        customerGstin: gstin,
        customerType: isB2B ? 'B2B' : 'B2C',
        productSku: it.productSku || '',
        productName: it.productName || '',
        hsnCode: it.product?.hsnCode ?? '',
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
      });
    }
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
  };

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
  { key: 'quantity', label: 'Quantity' },
  { key: 'taxableValue', label: 'Taxable Value' },
  { key: 'taxRate', label: 'Tax Rate %' },
  { key: 'cgst', label: 'CGST' },
  { key: 'sgst', label: 'SGST' },
  { key: 'igst', label: 'IGST' },
  { key: 'totalInvoiceValue', label: 'Total Invoice Value' },
  { key: 'placeOfSupplyName', label: 'Place of Supply' },
  { key: 'placeOfSupplyCode', label: 'State Code' },
  { key: 'isInterState', label: 'Inter-state' },
];
