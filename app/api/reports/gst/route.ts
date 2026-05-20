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
      ['Orders', report.summary.orders],
      ['Taxable Value', report.summary.taxableValue],
      ['CGST', report.summary.cgst],
      ['SGST', report.summary.sgst],
      ['IGST', report.summary.igst],
      ['Total Invoice Value', report.summary.totalInvoiceValue],
    ]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'MTR');
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
