'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, inr } from '@/lib/fetch';

type GstReportType = 'b2b' | 'b2c' | 'all';

interface GstReportRow {
  orderId: number;
  orderNumber: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerGstin: string;
  customerType: 'B2B' | 'B2C';
  productSku: string;
  productName: string;
  hsnCode: string;
  quantity: number;
  taxableValue: number;
  taxRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalInvoiceValue: number;
  placeOfSupplyName: string;
  placeOfSupplyCode: string;
  isInterState: 'Yes' | 'No';
}

interface GstReportSummary {
  rows: number;
  orders: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalInvoiceValue: number;
}

interface GstReportResponse {
  filters: { fy: string; month?: number; type: GstReportType };
  rangeStart: string;
  rangeEnd: string;
  rows: GstReportRow[];
  summary: GstReportSummary;
}

const MONTHS = [
  { value: 4, label: 'April' },   { value: 5, label: 'May' },
  { value: 6, label: 'June' },    { value: 7, label: 'July' },
  { value: 8, label: 'August' },  { value: 9, label: 'September' },
  { value: 10, label: 'October' },{ value: 11, label: 'November' },
  { value: 12, label: 'December' },
  { value: 1, label: 'January' }, { value: 2, label: 'February' },
  { value: 3, label: 'March' },
];

/** Build the FY string for a given date, "YYYY-YY" form. */
function currentFinancialYear(): string {
  const d = new Date();
  const m = d.getMonth();
  const y = d.getFullYear();
  const startYear = m >= 3 ? y : y - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function fyOptions(): string[] {
  const current = currentFinancialYear();
  const startYear = parseInt(current.slice(0, 4));
  // Offer current FY + 4 previous, in case admins reconcile old data.
  return Array.from({ length: 5 }, (_, i) => {
    const sy = startYear - i;
    return `${sy}-${String(sy + 1).slice(-2)}`;
  });
}

export default function GstReportsPage() {
  const fyChoices = useMemo(fyOptions, []);
  const [fy, setFy] = useState(fyChoices[0]);
  const [month, setMonth] = useState<number | ''>(new Date().getMonth() + 1);
  const [type, setType] = useState<GstReportType>('all');
  const [data, setData] = useState<GstReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview() {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ fy, type, format: 'json' });
      if (month !== '') q.set('month', String(month));
      const res = await api<GstReportResponse>('/api/reports/gst?' + q.toString());
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load report');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPreview(); /* eslint-disable-next-line */ }, [fy, month, type]);

  function buildDownloadUrl(format: 'xlsx' | 'csv'): string {
    const q = new URLSearchParams({ fy, type, format });
    if (month !== '') q.set('month', String(month));
    return '/api/reports/gst?' + q.toString();
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">GST Reports</h1>
          <p className="text-sm text-slate-500 mt-1">
            Monthly Merchant Tax Report (MTR) for GSTR-1 filing. Reflects paid orders
            with allocated invoice numbers (auto-allocated for any missing).
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Financial Year</label>
          <select className="input" value={fy} onChange={(e) => setFy(e.target.value)}>
            {fyChoices.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Month</label>
          <select
            className="input"
            value={month}
            onChange={(e) => setMonth(e.target.value === '' ? '' : parseInt(e.target.value))}
          >
            <option value="">Full FY</option>
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Transaction Type</label>
          <select
            className="input"
            value={type}
            onChange={(e) => setType(e.target.value as GstReportType)}
          >
            <option value="all">All</option>
            <option value="b2b">B2B (GSTIN holders)</option>
            <option value="b2c">B2C (no GSTIN)</option>
          </select>
        </div>

        <div className="ml-auto flex gap-2">
          <a className="btn-secondary" href={buildDownloadUrl('csv')} download>
            ↓ CSV
          </a>
          <a className="btn-primary" href={buildDownloadUrl('xlsx')} download>
            ↓ Excel (.xlsx)
          </a>
        </div>
      </div>

      {/* Reconciliation summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatCard label="Orders" value={data?.summary.orders ?? 0} />
        <StatCard label="Line items" value={data?.summary.rows ?? 0} />
        <StatCard label="Taxable value" value={inr(data?.summary.taxableValue ?? 0)} />
        <StatCard label="CGST" value={inr(data?.summary.cgst ?? 0)} />
        <StatCard label="SGST" value={inr(data?.summary.sgst ?? 0)} />
        <StatCard label="IGST" value={inr(data?.summary.igst ?? 0)} />
        <StatCard label="Total invoice" value={inr(data?.summary.totalInvoiceValue ?? 0)} highlight />
      </div>

      {/* Errors / empty / table */}
      {error && (
        <div className="card p-4 border-l-4 border-red-500 text-sm text-red-700 bg-red-50">
          {error}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="font-semibold">Report preview</div>
          {loading && <div className="text-xs text-slate-400">Loading…</div>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase">
              <tr>
                <Th>Invoice #</Th>
                <Th>Date</Th>
                <Th>Order #</Th>
                <Th>Type</Th>
                <Th>Customer</Th>
                <Th>GSTIN</Th>
                <Th>SKU</Th>
                <Th>HSN</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Taxable</Th>
                <Th align="right">CGST</Th>
                <Th align="right">SGST</Th>
                <Th align="right">IGST</Th>
                <Th align="right">Total</Th>
                <Th>State</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!loading && (!data || data.rows.length === 0) && (
                <tr>
                  <td colSpan={15} className="p-8 text-center text-slate-400">
                    No invoices in this period.
                  </td>
                </tr>
              )}
              {data?.rows.slice(0, 200).map((r, i) => (
                <tr key={`${r.orderId}-${i}`}>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{r.invoiceNumber}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.invoiceDate}</td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{r.orderNumber}</td>
                  <td className="px-3 py-2">
                    <span className={r.customerType === 'B2B' ? 'pill-blue' : 'pill-gray'}>
                      {r.customerType}
                    </span>
                  </td>
                  <td className="px-3 py-2">{r.customerName || '—'}</td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{r.customerGstin || '—'}</td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{r.productSku || '—'}</td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{r.hsnCode || '—'}</td>
                  <td className="px-3 py-2 text-right">{r.quantity}</td>
                  <td className="px-3 py-2 text-right">{inr(r.taxableValue)}</td>
                  <td className="px-3 py-2 text-right">{inr(r.cgst)}</td>
                  <td className="px-3 py-2 text-right">{inr(r.sgst)}</td>
                  <td className="px-3 py-2 text-right">{inr(r.igst)}</td>
                  <td className="px-3 py-2 text-right font-medium">{inr(r.totalInvoiceValue)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.placeOfSupplyName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.rows.length > 200 && (
          <div className="px-4 py-2 text-xs text-slate-500 border-t border-slate-200 bg-slate-50">
            Showing first 200 of {data.rows.length} rows — download Excel/CSV for the full report.
          </div>
        )}
      </div>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'} font-medium`}>
      {children}
    </th>
  );
}

function StatCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`card p-3 ${
        highlight ? 'bg-brand/5 border-brand/30' : ''
      }`}
    >
      <div className="text-[11px] uppercase text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-900 mt-1">{value}</div>
    </div>
  );
}
