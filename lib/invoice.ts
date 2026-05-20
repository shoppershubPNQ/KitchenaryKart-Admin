/**
 * GST-compliant tax invoice generator.
 *
 * Covers the mandatory fields under CGST Rule 46 for a B2B tax invoice:
 *  - Supplier name, address, GSTIN, state + state code
 *  - Recipient name, address, GSTIN (when present)
 *  - Invoice number, date
 *  - HSN/SAC per line item
 *  - Quantity, unit price, taxable value
 *  - CGST + SGST (intra-state) OR IGST (inter-state) with rate + amount
 *  - Place of supply (state name + code)
 *  - Reverse charge applicability
 *  - Authorized signatory block
 */
import PDFDocument from 'pdfkit';

export interface InvoiceItem {
  name: string;
  sku: string;
  hsnCode: string | null;
  quantity: number;
  /** Pre-tax unit price (already net of any discount). */
  unitPrice: number;
  /** Pre-tax line total = unitPrice × quantity (the "taxable value"). */
  taxableValue: number;
  /** Combined GST rate for this line, e.g. 18. */
  taxPercent: number;
  /** Pre-tax + tax line total — included so we don't recompute. */
  lineTotal: number;
}

export interface InvoiceInput {
  orderNumber: string;
  date: Date;
  company: {
    name: string;
    gst?: string;
    address?: string;
    state?: string;
    stateCode?: string;
  };
  customer: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    gstNumber?: string;
  };
  placeOfSupply: { name: string; code: string } | null;
  /** When true, IGST is charged (single column). When false, CGST + SGST split. */
  isInterState: boolean;
  items: InvoiceItem[];
  subtotal: number;
  /** Total tax (sum of all line GST amounts). */
  tax: number;
  /** Tax broken down for the summary block. */
  taxBreakdown: {
    cgst: number;
    sgst: number;
    igst: number;
  };
  shipping: number;
  total: number;
}

export async function renderInvoicePdf(inv: InvoiceInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers: Buffer[] = [];
    doc.on('data', (b: Buffer) => buffers.push(b));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const pageW = doc.page.width;
    const margin = 50;
    const contentW = pageW - margin * 2;

    // ── Header ─────────────────────────────────────────────────────────
    doc.fontSize(20).fillColor('#A01818').text(inv.company.name, margin, 50, { align: 'left' });
    let headerY = doc.y;
    if (inv.company.gst) {
      doc.fontSize(9).fillColor('#555').text(`GSTIN: ${inv.company.gst}`);
      headerY = doc.y;
    }
    if (inv.company.address) {
      doc.fontSize(9).fillColor('#555').text(inv.company.address, { width: 280 });
      headerY = doc.y;
    }
    if (inv.company.state) {
      doc
        .fontSize(9)
        .fillColor('#555')
        .text(
          `State: ${inv.company.state}${inv.company.stateCode ? ` (Code ${inv.company.stateCode})` : ''}`,
        );
      headerY = doc.y;
    }

    // Right column: TAX INVOICE + meta
    doc.fontSize(16).fillColor('#000').text('TAX INVOICE', margin, 50, { align: 'right' });
    doc.fontSize(10).text(`Invoice No.: ${inv.orderNumber}`, { align: 'right' });
    doc.text(`Date: ${inv.date.toLocaleDateString('en-IN')}`, { align: 'right' });
    doc.text('Reverse charge applicable: No', { align: 'right' });

    const afterHeaderY = Math.max(headerY, doc.y);
    doc.y = afterHeaderY + 16;

    // ── Bill To + Place of Supply ──────────────────────────────────────
    const billToY = doc.y;
    doc.fontSize(11).fillColor('#000').text('Bill to:', margin, billToY);
    doc.fontSize(10).fillColor('#333');
    doc.text(inv.customer.name, margin, doc.y);
    if (inv.customer.email) doc.text(inv.customer.email);
    if (inv.customer.phone) doc.text(inv.customer.phone);
    if (inv.customer.address) doc.text(inv.customer.address, { width: 280 });
    if (inv.customer.gstNumber) doc.text(`GSTIN: ${inv.customer.gstNumber}`);

    const leftAfterBillY = doc.y;

    // Right side: Place of supply
    if (inv.placeOfSupply) {
      doc.fontSize(11).fillColor('#000').text('Place of supply:', margin, billToY, { align: 'right' });
      doc
        .fontSize(10)
        .fillColor('#333')
        .text(
          `${inv.placeOfSupply.name} (${inv.placeOfSupply.code})`,
          margin,
          doc.y,
          { align: 'right' },
        );
      doc
        .fontSize(9)
        .fillColor('#777')
        .text(
          inv.isInterState
            ? 'Inter-state supply — IGST applicable'
            : 'Intra-state supply — CGST + SGST applicable',
          margin,
          doc.y,
          { align: 'right' },
        );
    }

    doc.y = Math.max(leftAfterBillY, doc.y) + 12;

    // ── Items table ────────────────────────────────────────────────────
    // Columns: # · Item · HSN · Qty · Rate · Taxable · GST% · Total
    const tableTop = doc.y + 4;
    const col = {
      n: margin,
      name: margin + 22,
      hsn: margin + 230,
      qty: margin + 290,
      rate: margin + 325,
      taxable: margin + 385,
      gstPct: margin + 445,
      total: margin + 490,
    };
    const tableRight = margin + contentW;

    doc.fontSize(9).fillColor('#000');
    doc.rect(margin, tableTop, contentW, 18).fillAndStroke('#F5F1EA', '#D4C9B0');
    doc.fillColor('#000');
    doc.text('#', col.n + 2, tableTop + 5);
    doc.text('Item / SKU', col.name + 2, tableTop + 5);
    doc.text('HSN', col.hsn + 2, tableTop + 5);
    doc.text('Qty', col.qty + 2, tableTop + 5);
    doc.text('Rate', col.rate + 2, tableTop + 5);
    doc.text('Taxable', col.taxable + 2, tableTop + 5);
    doc.text('GST%', col.gstPct + 2, tableTop + 5);
    doc.text('Total', col.total + 2, tableTop + 5);

    let y = tableTop + 22;
    inv.items.forEach((it, i) => {
      const rowH = 22;
      if (y + rowH > 720) {
        doc.addPage();
        y = 50;
      }
      doc.fillColor('#333').fontSize(9);
      doc.text(String(i + 1), col.n + 2, y, { width: 18 });
      doc.text(it.name, col.name + 2, y, { width: col.hsn - col.name - 6, ellipsis: true });
      doc
        .fontSize(8)
        .fillColor('#888')
        .text(`SKU ${it.sku}`, col.name + 2, y + 11, {
          width: col.hsn - col.name - 6,
          ellipsis: true,
        });
      doc.fontSize(9).fillColor('#333');
      doc.text(it.hsnCode || '—', col.hsn + 2, y, { width: col.qty - col.hsn - 6 });
      doc.text(String(it.quantity), col.qty + 2, y, { width: col.rate - col.qty - 6 });
      doc.text(inr(it.unitPrice), col.rate + 2, y, { width: col.taxable - col.rate - 6 });
      doc.text(inr(it.taxableValue), col.taxable + 2, y, { width: col.gstPct - col.taxable - 6 });
      doc.text(`${it.taxPercent}%`, col.gstPct + 2, y, { width: col.total - col.gstPct - 6 });
      doc.text(inr(it.lineTotal), col.total + 2, y, { width: tableRight - col.total - 4 });
      doc.moveTo(margin, y + rowH - 2).lineTo(tableRight, y + rowH - 2).strokeColor('#EEE7D6').stroke();
      y += rowH;
    });

    // ── Totals block ───────────────────────────────────────────────────
    y += 6;
    doc.strokeColor('#000');
    const totalsLabelX = margin + 350;
    const totalsValueX = margin + 460;

    function totalRow(label: string, value: string, bold = false) {
      if (bold) doc.font('Helvetica-Bold');
      else doc.font('Helvetica');
      doc.fontSize(10).fillColor(bold ? '#000' : '#333');
      doc.text(label, totalsLabelX, y, { width: 100 });
      doc.text(value, totalsValueX, y, { width: tableRight - totalsValueX, align: 'right' });
      y += 16;
    }

    totalRow('Subtotal', inr(inv.subtotal));
    if (inv.isInterState) {
      totalRow(`IGST`, inr(inv.taxBreakdown.igst));
    } else {
      totalRow(`CGST`, inr(inv.taxBreakdown.cgst));
      totalRow(`SGST`, inr(inv.taxBreakdown.sgst));
    }
    if (inv.shipping > 0) totalRow('Shipping', inr(inv.shipping));
    doc.moveTo(totalsLabelX, y).lineTo(tableRight, y).strokeColor('#000').stroke();
    y += 6;
    totalRow('Total payable', inr(inv.total), true);

    // Amount in words
    doc.font('Helvetica');
    y += 10;
    doc
      .fontSize(9)
      .fillColor('#555')
      .text(`Amount in words: ${rupeeWords(inv.total)} only.`, margin, y, {
        width: contentW,
      });
    y = doc.y + 16;

    // ── Footer / signatory block ───────────────────────────────────────
    const footerY = Math.max(y, 720);
    doc.moveTo(margin, footerY).lineTo(tableRight, footerY).strokeColor('#D4C9B0').stroke();

    doc
      .fontSize(8)
      .fillColor('#777')
      .text(
        'Declaration: Goods once sold cannot be taken back without prior approval. Returns and refunds are subject to the policies published at kitchenarykart.com.',
        margin,
        footerY + 8,
        { width: 320 },
      );

    doc
      .fontSize(9)
      .fillColor('#000')
      .text(`For ${inv.company.name}`, margin + 360, footerY + 30, { width: 180, align: 'right' });
    doc
      .fontSize(8)
      .fillColor('#555')
      .text('Authorized signatory', margin + 360, footerY + 60, { width: 180, align: 'right' });

    doc.end();
  });
}

function inr(n: number): string {
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/**
 * Convert a rupee amount to Indian-English words (e.g. 1234.50 →
 * "One Thousand Two Hundred Thirty Four Rupees and Fifty Paise").
 * Uses the Indian numbering system (lakh, crore).
 */
function rupeeWords(amount: number): string {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  const parts: string[] = [];
  parts.push(`${numberToIndianWords(rupees)} Rupees`);
  if (paise > 0) parts.push(`${numberToIndianWords(paise)} Paise`);
  return parts.join(' and ');
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function under1000(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + under1000(n % 100) : '');
}

function numberToIndianWords(n: number): string {
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10000000);
  n -= crore * 10000000;
  const lakh = Math.floor(n / 100000);
  n -= lakh * 100000;
  const thousand = Math.floor(n / 1000);
  n -= thousand * 1000;
  const rest = n;
  const parts: string[] = [];
  if (crore) parts.push(under1000(crore) + ' Crore');
  if (lakh) parts.push(under1000(lakh) + ' Lakh');
  if (thousand) parts.push(under1000(thousand) + ' Thousand');
  if (rest) parts.push(under1000(rest));
  return parts.join(' ');
}
