/**
 * GET /api/reports/gst
 *
 * Generates the monthly GST Merchant Tax Report (MTR). Returns JSON
 * for the dashboard preview, or downloads an .xlsx / .csv file.
 *
 * Query params:
 *   fy       — financial year, e.g. "2026-27" (required)
 *   month    — calendar month 1-12 (optional; omit for full FY)
 *   type     — "b2b" | "b2c" | "all" (default "all")
 *   format   — "json" | "xlsx" | "csv" (default "json")
 *
 * The CSV carries the sales rows only. The xlsx adds the Credit Notes sheet,
 * the Cancelled Invoices sheet (paid orders cancelled before dispatch — NOT in
 * the sales rows; GSTR-1 Table 13), the Cancelled Credit Notes sheet (notes
 * cancelled before filing — in no total; Table 13) and the Summary.
 */
import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import {
  generateGstReport,
  REPORT_COLUMNS,
  type GstReportRow,
  type GstReportType,
  type GstCreditNoteRow,
  type GstCancelledInvoiceRow,
  type GstCancelledCreditNoteRow,
} from '@/lib/gst-report';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const fy = url.searchParams.get('fy')?.trim() || '';
    const monthRaw = url.searchParams.get('month');
    const month = monthRaw ? parseInt(monthRaw) : undefined;
    const type = (url.searchParams.get('type') || 'all') as GstReportType;
    const format = (url.searchParams.get('format') || 'json') as 'json' | 'xlsx' | 'csv';

    if (!/^\d{4}-\d{2}$/.test(fy)) {
      return fail('fy must be in YYYY-YY form (e.g. 2026-27)');
    }
    if (month !== undefined && (month < 1 || month > 12 || Number.isNaN(month))) {
      return fail('month must be 1-12');
    }
    if (!['b2b', 'b2c', 'all'].includes(type)) {
      return fail('type must be b2b, b2c or all');
    }
    if (!['json', 'xlsx', 'csv'].includes(format)) {
      return fail('format must be json, xlsx or csv');
    }

    const report = await generateGstReport({ fy, month, type });

    if (format === 'json') {
      return ok(report);
    }

    const filenameBase = buildFilenameBase(fy, month, type);

    if (format === 'csv') {
      const csv = toCsv(report.rows);
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filenameBase}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    // xlsx
    const sheetRows = report.rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const col of REPORT_COLUMNS) out[col.label] = r[col.key];
      return out;
    });
    const sheet = XLSX.utils.json_to_sheet(sheetRows, {
      header: REPORT_COLUMNS.map((c) => c.label),
    });

    // Summary sheet — totals + filter metadata. Keeps reconciliation
    // numbers next to the data without polluting the row sheet.
    const summary = XLSX.utils.aoa_to_sheet([
      ['Filter', 'Value'],
      ['Financial Year', fy],
      ['Month', month ?? 'All'],
      ['Transaction Type', type.toUpperCase()],
      ['Range Start', report.rangeStart.toISOString().slice(0, 10)],
      ['Range End', report.rangeEnd.toISOString().slice(0, 10)],
      [],
      ['Totals', ''],
      ['Rows', report.summary.rows],
      ['Invoices', report.summary.orders],
      ['Taxable Value (before discount)', report.summary.grossTaxableValue],
      ['Less: coupon discount', -report.summary.discountTotal],
      ['Shipping / freight (excl. GST)', report.summary.shippingTaxable],
      ['Shipping / freight GST', report.summary.shippingGst],
      ['Shipping / freight (incl. GST)', report.summary.shippingInclGst],
      ['Taxable Value (filed)', report.summary.taxableValue],
      ['CGST', report.summary.cgst],
      ['SGST', report.summary.sgst],
      ['IGST', report.summary.igst],
      ['Line Total', report.summary.totalInvoiceValue],
      ['Round Off', report.summary.roundOff],
      [],
      ['Credit Notes', ''],
      ['Notes issued this period', report.summary.creditNoteCount],
      ['Credit note taxable value', -report.summary.creditNoteTaxable],
      ['Credit note CGST', -report.summary.creditNoteCgst],
      ['Credit note SGST', -report.summary.creditNoteSgst],
      ['Credit note IGST', -report.summary.creditNoteIgst],
      ['NET taxable value (after credit notes)', report.summary.netTaxableValue],
      ['NET GST (after credit notes)', report.summary.netGst],
      [],
      // The check that says whether this file may be submitted: the report's
      // own lines must equal what the customers were charged.
      ['Reconciliation', ''],
      ['Amount charged to customers', report.summary.ordersTotalAmount],
      ['Lines + round off', report.summary.totalInvoiceValue + report.summary.roundOff],
      ['Gap (must be 0)', report.summary.reconciliationGap],
      [],
      // GSTR-1 Table 13 — documents issued. Cancelled invoices are NOT in the
      // sales rows or any total above; they are listed on their own sheet.
      ['Documents issued (GSTR-1 Table 13) — invoices, whole series (all types)', ''],
      ['Serial from', report.summary.invoiceFrom],
      ['Serial to', report.summary.invoiceTo],
      ['Total issued', report.summary.invoicesIssued],
      ['Cancelled (before dispatch)', report.summary.invoicesCancelled],
      ['Net issued', report.summary.invoicesIssued - report.summary.invoicesCancelled],
      ['Cancelled invoices value (not in sales)', report.summary.cancelledInvoiceValue],
      ['Cancelled invoices whose order is active again (check)', report.summary.cancelledInvoiceActiveAgain],
      [],
      // Same table, credit notes: every note issued in the period, active or
      // cancelled. A cancelled note is in no total above (own sheet).
      ['Documents issued (GSTR-1 Table 13) — credit notes, whole series (all types)', ''],
      ['Serial from', report.summary.creditNoteFrom],
      ['Serial to', report.summary.creditNoteTo],
      ['Total issued', report.summary.creditNotesIssued],
      ['Cancelled', report.summary.creditNotesCancelled],
      ['Net issued', report.summary.creditNotesIssued - report.summary.creditNotesCancelled],
      [],
      ['Needs attention', ''],
      ['Cancelled orders still in sales, no credit note', report.summary.cancelledOrders],
      ['Returned / refunded, no credit note yet', report.summary.returnedOrders],
    ]);

    // Credit notes get their OWN sheet, in CDNR/CDNUR filing detail. GSTR-1
    // files them in a separate table from sales, and a negative line sitting
    // among the MTR rows would be double counted by anyone summing the sheet.
    // Before this the Summary carried only the totals — the CA could see that
    // ₹770 had been reversed but not against which invoice or for what.
    const CN_COLUMNS: Array<[keyof GstCreditNoteRow, string]> = [
      ['creditNoteNumber', 'Credit Note Number'],
      ['creditNoteDate', 'Credit Note Date'],
      ['noteType', 'Note Type'],
      ['originalInvoiceNumber', 'Original Invoice Number'],
      ['originalInvoiceDate', 'Original Invoice Date'],
      ['orderNumber', 'Order Number'],
      ['customerName', 'Customer Name'],
      ['customerGstin', 'Customer GSTIN'],
      ['customerType', 'Customer Type'],
      ['placeOfSupplyName', 'Place of Supply'],
      ['placeOfSupplyCode', 'State Code'],
      ['reason', 'Reason'],
      ['taxableValue', 'Taxable Value'],
      ['cgst', 'CGST'],
      ['sgst', 'SGST'],
      ['igst', 'IGST'],
      ['totalAmount', 'Total Credited'],
      ['notes', 'Notes'],
    ];
    const cnSheet = XLSX.utils.json_to_sheet(
      report.creditNotes.map((c) => {
        const out: Record<string, unknown> = {};
        for (const [key, label] of CN_COLUMNS) out[label] = c[key];
        return out;
      }),
      { header: CN_COLUMNS.map(([, label]) => label) },
    );

    // Paid invoices whose order was cancelled before dispatch: the number was
    // issued, nothing was supplied. Declared as cancelled in GSTR-1 Table 13 —
    // kept off the MTR sheet so nobody files them as sales.
    const CX_COLUMNS: Array<[keyof GstCancelledInvoiceRow, string]> = [
      ['invoiceNumber', 'Invoice Number'],
      ['invoiceDate', 'Invoice Date'],
      ['orderNumber', 'Order Number'],
      ['customerName', 'Customer Name'],
      ['customerGstin', 'Customer GSTIN'],
      ['customerType', 'Customer Type'],
      ['placeOfSupplyName', 'Place of Supply'],
      ['placeOfSupplyCode', 'State Code'],
      ['taxableValue', 'Taxable Value'],
      ['cgst', 'CGST'],
      ['sgst', 'SGST'],
      ['igst', 'IGST'],
      ['roundOff', 'Round Off'],
      ['invoiceValue', 'Invoice Value (refunded)'],
      ['cancelledOn', 'Cancelled On'],
      ['orderStatus', 'Order Status'],
      ['paymentStatus', 'Payment Status'],
      ['reason', 'Reason'],
    ];
    const cxSheet = XLSX.utils.json_to_sheet(
      report.cancelledInvoices.map((c) => {
        const out: Record<string, unknown> = {};
        for (const [key, label] of CX_COLUMNS) out[label] = c[key];
        return out;
      }),
      { header: CX_COLUMNS.map(([, label]) => label) },
    );

    // Credit notes cancelled before filing: the number was used, so Table 13
    // declares it as cancelled, but it reverses nothing — kept off the Credit
    // Notes sheet so nobody deducts it.
    const CCN_COLUMNS: Array<[keyof GstCancelledCreditNoteRow, string]> = [
      ['creditNoteNumber', 'Credit Note Number'],
      ['creditNoteDate', 'Credit Note Date'],
      ['originalInvoiceNumber', 'Original Invoice Number'],
      ['originalInvoiceDate', 'Original Invoice Date'],
      ['orderNumber', 'Order Number'],
      ['customerName', 'Customer Name'],
      ['customerGstin', 'Customer GSTIN'],
      ['customerType', 'Customer Type'],
      ['placeOfSupplyName', 'Place of Supply'],
      ['placeOfSupplyCode', 'State Code'],
      ['reason', 'Reason (as issued)'],
      ['taxableValue', 'Taxable Value (as issued)'],
      ['cgst', 'CGST (as issued)'],
      ['sgst', 'SGST (as issued)'],
      ['igst', 'IGST (as issued)'],
      ['totalAmount', 'Total (as issued)'],
      ['cancelledOn', 'Cancelled On'],
      ['cancelReason', 'Why Cancelled'],
    ];
    const ccnSheet = XLSX.utils.json_to_sheet(
      (report.cancelledCreditNotes ?? []).map((c) => {
        const out: Record<string, unknown> = {};
        for (const [key, label] of CCN_COLUMNS) out[label] = c[key];
        return out;
      }),
      { header: CCN_COLUMNS.map(([, label]) => label) },
    );

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'MTR');
    XLSX.utils.book_append_sheet(wb, cnSheet, 'Credit Notes');
    XLSX.utils.book_append_sheet(wb, cxSheet, 'Cancelled Invoices');
    XLSX.utils.book_append_sheet(wb, ccnSheet, 'Cancelled Credit Notes');
    XLSX.utils.book_append_sheet(wb, summary, 'Summary');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filenameBase}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return handleError(e);
  }
});

function buildFilenameBase(fy: string, month: number | undefined, type: GstReportType): string {
  const parts = ['MTR', fy];
  if (month) parts.push(String(month).padStart(2, '0'));
  parts.push(type.toUpperCase());
  return parts.join('-');
}

function toCsv(rows: GstReportRow[]): string {
  const header = REPORT_COLUMNS.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((r) =>
    REPORT_COLUMNS.map((c) => csvCell(r[c.key])).join(','),
  );
  // BOM so Excel opens UTF-8 with rupee/currency symbols intact.
  return '﻿' + [header, ...body].join('\r\n') + '\r\n';
}

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
