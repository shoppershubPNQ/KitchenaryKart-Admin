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
  /** Cancelled orders STILL in sales with no credit note — each needs one. Normally 0. */
  cancelledOrders: number;
  cancelledValue: number;
  /** Returned / refunded (not cancelled) with no credit note yet. */
  returnedOrders: number;
  returnedValue: number;
  /** Paid orders cancelled before dispatch — NOT in the sales rows or totals. */
  cancelledInvoiceCount: number;
  cancelledInvoiceTaxable: number;
  cancelledInvoiceGst: number;
  cancelledInvoiceValue: number;
  /** Cancelled invoices whose order became active again after the month ended. */
  cancelledInvoiceActiveAgain: number;
  /** GSTR-1 Table 13 (invoices): the whole series for the period, all types. */
  invoiceFrom: string;
  invoiceTo: string;
  invoicesIssued: number;
  invoicesCancelled: number;
  creditNoteCount: number;
  creditNoteTaxable: number;
  creditNoteCgst: number;
  creditNoteSgst: number;
  creditNoteIgst: number;
  creditNoteTotal: number;
  netTaxableValue: number;
  netGst: number;
  /** Coupon discount deducted, and the pre-discount taxable total. */
  discountTotal: number;
  grossTaxableValue: number;
  /** Freight billed and the GST collected on it. */
  shippingTaxable: number;
  shippingGst: number;
  shippingInclGst: number;
  roundOff: number;
  /** Sum of the orders' own totals, and the gap against the report's lines.
   *  Must be 0 — anything else means the report has drifted from the invoices. */
  ordersTotalAmount: number;
  reconciliationGap: number;
}

interface GstCreditNoteRow {
  creditNoteNumber: string;
  creditNoteDate: string;
  originalInvoiceNumber: string;
  originalInvoiceDate: string;
  orderNumber: string;
  customerName: string;
  customerGstin: string;
  customerType: string;
  placeOfSupplyName: string;
  placeOfSupplyCode: string;
  reason: string;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalAmount: number;
  notes: string;
}

interface GstCancelledInvoiceRow {
  invoiceNumber: string;
  invoiceDate: string;
  orderNumber: string;
  customerName: string;
  customerGstin: string;
  customerType: string;
  placeOfSupplyName: string;
  placeOfSupplyCode: string;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  invoiceValue: number;
  cancelledOn: string;
  orderStatus: string;
  paymentStatus: string;
  reason: string;
}

interface GstReportResponse {
  filters: { fy: string; month?: number; type: GstReportType };
  rangeStart: string;
  rangeEnd: string;
  rows: GstReportRow[];
  creditNotes: GstCreditNoteRow[];
  /** Absent from a response produced before the cancelled-invoices split. */
  cancelledInvoices?: GstCancelledInvoiceRow[];
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
            with allocated invoice numbers (auto-allocated for any missing). Paid orders
            cancelled before dispatch are listed separately as cancelled invoices, not as sales.
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

      {/* Coupon discounts are stored per ORDER but GST is filed per line, so the
          sheet apportions them. The gross taxable value is what this report has
          always produced; whether the discount may be netted off depends on how
          it appears on the invoice, so both totals are shown and neither is
          silently chosen. */}
      {/* The one number that says whether this file is safe to submit: the
          report's own lines, plus round-off, must equal what the customers were
          actually charged. */}
      {data && (
        <div
          className={`card p-4 border-l-4 text-sm ${
            data.summary.reconciliationGap === 0
              ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
              : 'border-red-500 bg-red-50 text-red-900'
          }`}
        >
          {data.summary.reconciliationGap === 0 ? (
            <>
              <span className="font-semibold">Reconciled.</span> The {data.summary.rows} lines
              total {inr(data.summary.totalInvoiceValue)} plus {inr(data.summary.roundOff)} round-off,
              which matches the {inr(data.summary.ordersTotalAmount)} charged across{' '}
              {data.summary.orders} invoices.
            </>
          ) : (
            <>
              <span className="font-semibold">
                Does not reconcile — off by {inr(data.summary.reconciliationGap)}.
              </span>{' '}
              The report and the issued invoices disagree. Do not file until this is resolved.
            </>
          )}
        </div>
      )}

      {/* Taxable value is filed NET of discount and INCLUDES freight, matching
          the invoice. Both moving parts are spelled out so the figure can be
          checked without opening the sheet. */}
      {data && (!!data.summary.discountTotal || !!data.summary.shippingTaxable) && (
        <div className="card p-4 border-l-4 border-sky-500 text-sm bg-sky-50 text-sky-900 space-y-1">
          <div>
            <span className="font-semibold">Taxable value {inr(data.summary.taxableValue)}</span>{' '}
            = {inr(data.summary.grossTaxableValue)} goods
            {!!data.summary.discountTotal && <> − {inr(data.summary.discountTotal)} coupon discount</>}
            {!!data.summary.shippingTaxable && <> + {inr(data.summary.shippingTaxable)} shipping</>}.
          </div>
          {!!data.summary.shippingTaxable && (
            <div className="text-xs">
              Shipping: {inr(data.summary.shippingTaxable)} excl. GST + {inr(data.summary.shippingGst)} GST = {inr(data.summary.shippingInclGst)} charged. Included
              in the goods lines&apos; taxable value (composite supply), not on rows of its own.
            </div>
          )}
        </div>
      )}

      {/* Credit notes reduce THIS month's liability and are filed in GSTR-1's own
          CDNR/CDNUR table, so the net figure is stated rather than left to be
          worked out from two numbers. */}
      {!!data?.summary.creditNoteCount && (
        <div className="card p-4 border-l-4 border-indigo-500 text-sm bg-indigo-50 text-indigo-900">
          <span className="font-semibold">
            {data.summary.creditNoteCount} credit {data.summary.creditNoteCount === 1 ? 'note' : 'notes'} issued this period
            {' '}— {inr(data.summary.creditNoteTaxable)} taxable, {inr(data.summary.creditNoteTotal)} total.
          </span>{' '}
          After them the month files at <span className="font-semibold">{inr(data.summary.netTaxableValue)} taxable</span>{' '}
          and <span className="font-semibold">{inr(data.summary.netGst)} GST</span>. They go in GSTR-1's credit note
          table (CDNR/CDNUR), not netted into the sales rows.

          {/* The detail the CA actually files with: which invoice was reversed,
              for what, and the rate-wise split. Previously only the totals were
              shown, so "₹770 was credited" could not be traced to an invoice
              without opening the database. Also exported as the "Credit Notes"
              sheet in the .xlsx. */}
          {!!data.creditNotes?.length && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs bg-white rounded border border-indigo-200">
                <thead className="bg-indigo-100 text-indigo-900">
                  <tr>
                    <th className="text-left px-2 py-1.5">Credit Note</th>
                    <th className="text-left px-2 py-1.5">Date</th>
                    <th className="text-left px-2 py-1.5">Against Invoice</th>
                    <th className="text-left px-2 py-1.5">Customer</th>
                    <th className="text-left px-2 py-1.5">Place of Supply</th>
                    <th className="text-left px-2 py-1.5">Reason</th>
                    <th className="text-right px-2 py-1.5">Taxable</th>
                    <th className="text-right px-2 py-1.5">CGST</th>
                    <th className="text-right px-2 py-1.5">SGST</th>
                    <th className="text-right px-2 py-1.5">IGST</th>
                    <th className="text-right px-2 py-1.5">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-indigo-100 text-slate-700">
                  {data.creditNotes.map((c) => (
                    <tr key={c.creditNoteNumber}>
                      <td className="px-2 py-1.5 font-mono">{c.creditNoteNumber}</td>
                      <td className="px-2 py-1.5">{c.creditNoteDate}</td>
                      <td className="px-2 py-1.5 font-mono">
                        {c.originalInvoiceNumber}
                        <span className="text-slate-400 ml-1">({c.originalInvoiceDate})</span>
                      </td>
                      <td className="px-2 py-1.5">
                        {c.customerName}
                        <span className="text-slate-400 ml-1">{c.customerType}</span>
                        {c.customerGstin && <div className="font-mono text-[10px] text-slate-400">{c.customerGstin}</div>}
                      </td>
                      <td className="px-2 py-1.5">
                        {c.placeOfSupplyName}
                        {c.placeOfSupplyCode && <span className="text-slate-400 ml-1">({c.placeOfSupplyCode})</span>}
                      </td>
                      <td className="px-2 py-1.5">{c.reason}</td>
                      <td className="px-2 py-1.5 text-right">{inr(c.taxableValue)}</td>
                      <td className="px-2 py-1.5 text-right">{inr(c.cgst)}</td>
                      <td className="px-2 py-1.5 text-right">{inr(c.sgst)}</td>
                      <td className="px-2 py-1.5 text-right">{inr(c.igst)}</td>
                      <td className="px-2 py-1.5 text-right font-semibold">{inr(c.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Paid orders cancelled BEFORE DISPATCH: the invoice number was issued but
          nothing was supplied, so they are NOT in the sales rows or any total
          above. GSTR-1 declares them as cancelled documents (Table 13). Also the
          "Cancelled Invoices" sheet in the .xlsx. */}
      {!!data?.summary.cancelledInvoiceCount && (
        <div className="card p-4 border-l-4 border-slate-500 text-sm bg-slate-50 text-slate-900">
          <span className="font-semibold">
            {data.summary.cancelledInvoiceCount} cancelled {data.summary.cancelledInvoiceCount === 1 ? 'invoice' : 'invoices'}
            {' '}({inr(data.summary.cancelledInvoiceValue)}) — not counted as sales.
          </span>{' '}
          Paid, then cancelled before dispatch in the same month. Report {data.summary.cancelledInvoiceCount === 1 ? 'it' : 'them'} in
          GSTR-1 Table 13 as cancelled. Whole series for the month (all types): invoices {data.summary.invoiceFrom} to{' '}
          {data.summary.invoiceTo}, {data.summary.invoicesIssued} issued, {data.summary.invoicesCancelled} cancelled,{' '}
          {data.summary.invoicesIssued - data.summary.invoicesCancelled} net. No credit note is needed for these.
          {!!data.summary.cancelledInvoiceActiveAgain && (
            <div className="mt-2 font-semibold text-red-700">
              {data.summary.cancelledInvoiceActiveAgain} of these orders {data.summary.cancelledInvoiceActiveAgain === 1 ? 'is' : 'are'} active
              again (status changed after the month ended). Check {data.summary.cancelledInvoiceActiveAgain === 1 ? 'it' : 'them'} — if the
              goods are now going out, a fresh invoice is needed.
            </div>
          )}
          {!!data.cancelledInvoices?.length && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs bg-white rounded border border-slate-200">
                <thead className="bg-slate-100 text-slate-900">
                  <tr>
                    <th className="text-left px-2 py-1.5">Invoice</th>
                    <th className="text-left px-2 py-1.5">Order</th>
                    <th className="text-left px-2 py-1.5">Customer</th>
                    <th className="text-left px-2 py-1.5">Place of Supply</th>
                    <th className="text-left px-2 py-1.5">Cancelled On</th>
                    <th className="text-right px-2 py-1.5">Taxable</th>
                    <th className="text-right px-2 py-1.5">GST</th>
                    <th className="text-right px-2 py-1.5">Invoice Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {data.cancelledInvoices.map((c) => (
                    <tr key={c.invoiceNumber}>
                      <td className="px-2 py-1.5 font-mono">
                        {c.invoiceNumber}
                        <span className="text-slate-400 ml-1">({c.invoiceDate})</span>
                      </td>
                      <td className="px-2 py-1.5 font-mono">{c.orderNumber}</td>
                      <td className="px-2 py-1.5">
                        {c.customerName}
                        <span className="text-slate-400 ml-1">{c.customerType}</span>
                        {c.customerGstin && <div className="font-mono text-[10px] text-slate-400">{c.customerGstin}</div>}
                      </td>
                      <td className="px-2 py-1.5">
                        {c.placeOfSupplyName}
                        {c.placeOfSupplyCode && <span className="text-slate-400 ml-1">({c.placeOfSupplyCode})</span>}
                      </td>
                      <td className="px-2 py-1.5">{c.cancelledOn}</td>
                      <td className="px-2 py-1.5 text-right">{inr(c.taxableValue)}</td>
                      <td className="px-2 py-1.5 text-right">{inr(c.cgst + c.sgst + c.igst)}</td>
                      <td className="px-2 py-1.5 text-right font-semibold">{inr(c.invoiceValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* A returned invoice stays in the return — the sale happened and was
          invoiced — but the refund is settled by a CREDIT NOTE in the month the
          return occurred, so it must not be forgotten. Counted only while no
          credit note exists for it. */}
      {!!data?.summary.returnedOrders && (
        <div className="card p-4 border-l-4 border-purple-500 text-sm bg-purple-50 text-purple-900">
          <span className="font-semibold">
            {data.summary.returnedOrders} returned/refunded {data.summary.returnedOrders === 1 ? 'invoice' : 'invoices'}
            {' '}({inr(data.summary.returnedValue)}) with no credit note yet.
          </span>{' '}
          They stay in this return because the sale was invoiced. Raise a CREDIT NOTE
          in the month the goods came back — do not remove them from here.
        </div>
      )}

      {/* A cancelled order still in the sales rows (something was dispatched,
          or it was cancelled after its invoice's month ended) with no credit
          note: filing it as revenue overstates the liability — a credit note is
          due. Cancelled orders that already have one are not counted. */}
      {!!data?.summary.cancelledOrders && (
        <div className="card p-4 border-l-4 border-amber-500 text-sm bg-amber-50 text-amber-900">
          <span className="font-semibold">
            {data.summary.cancelledOrders} cancelled {data.summary.cancelledOrders === 1 ? 'order is' : 'orders are'} still
            in the sales rows with no credit note ({inr(data.summary.cancelledValue)}).
          </span>{' '}
          Paid and then cancelled, but something was dispatched, or it was cancelled after the
          invoice&apos;s month ended. Raise a credit note in the month of the cancellation, or check the order.
        </div>
      )}

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
        {/* Capped-height scroll region: the summary cards + filters above stay
            put, and the column headers stay pinned (sticky thead) while you
            scroll the rows — so nothing important scrolls out of view. */}
        <div className="overflow-auto max-h-[65vh]">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase sticky top-0 z-10 shadow-[inset_0_-1px_0_rgb(226,232,240)]">
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
