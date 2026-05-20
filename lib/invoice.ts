/**
 * GST-compliant tax invoice generator — Amazon-style layout.
 *
 * Matches the structure of an Amazon.in tax invoice the merchant
 * already receives: two-column header with seller info (left) and
 * the "Tax Invoice / Bill of Supply / Cash Memo" declaration (right),
 * separate Billing + Shipping address blocks, items table with HSN
 * inline in the description, Tax Type column showing IGST or
 * CGST+SGST, totals + amount-in-words + signatory block + reverse
 * charge declaration in the footer.
 *
 * Covers the mandatory fields under CGST Rule 46 for a B2B invoice.
 */
import PDFDocument from 'pdfkit';

export interface InvoiceItem {
  name: string;
  sku: string;
  hsnCode: string | null;
  quantity: number;
  /** Pre-tax unit price. */
  unitPrice: number;
  /** Pre-tax line total = unitPrice × quantity (the "taxable value"). */
  taxableValue: number;
  /** Combined GST rate for this line, e.g. 18. */
  taxPercent: number;
  /** Line total = taxableValue + tax. */
  lineTotal: number;
}

export interface InvoiceInput {
  orderNumber: string;
  date: Date;
  company: {
    name: string;
    legalName?: string;
    gst?: string;
    pan?: string;
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
  /** Inter-state ⇒ IGST single line; intra-state ⇒ CGST + SGST split. */
  isInterState: boolean;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  taxBreakdown: { cgst: number; sgst: number; igst: number };
  shipping: number;
  total: number;
}

const PAGE_MARGIN = 36;
const COL_GAP = 16;

export async function renderInvoicePdf(inv: InvoiceInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
    const buffers: Buffer[] = [];
    doc.on('data', (b: Buffer) => buffers.push(b));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const pageW = doc.page.width;
    const contentW = pageW - PAGE_MARGIN * 2;
    const colW = (contentW - COL_GAP) / 2;
    const leftX = PAGE_MARGIN;
    const rightX = PAGE_MARGIN + colW + COL_GAP;

    // ── Header: seller (left) + invoice declaration (right) ──────────
    let yTop = PAGE_MARGIN;
    doc.fontSize(18).fillColor('#A01818').font('Helvetica-Bold').text(inv.company.name, leftX, yTop, {
      width: colW,
    });
    const sellerNameY = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor('#333');
    if (inv.company.address) doc.text(inv.company.address, leftX, sellerNameY + 4, { width: colW });
    if (inv.company.pan) doc.text(`PAN No: ${inv.company.pan}`, leftX, doc.y + 2, { width: colW });
    if (inv.company.gst) doc.text(`GST Registration No: ${inv.company.gst}`, leftX, doc.y, { width: colW });

    const leftHeaderEndY = doc.y;

    // Right column — invoice declaration
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(
      'Tax Invoice / Bill of Supply / Cash Memo',
      rightX,
      yTop + 4,
      { width: colW, align: 'right' },
    );
    doc.font('Helvetica').fontSize(9).fillColor('#555').text('(Triplicate for Supplier)', rightX, doc.y, {
      width: colW,
      align: 'right',
    });

    yTop = Math.max(leftHeaderEndY, doc.y) + 14;
    doc.moveTo(leftX, yTop).lineTo(leftX + contentW, yTop).strokeColor('#CFC5A8').stroke();

    // ── Order info (left) + Billing/Shipping (right) ─────────────────
    let y = yTop + 10;
    const orderInfoY = y;

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text('Order Number:', leftX, y);
    doc.font('Helvetica').text(inv.orderNumber, leftX + 88, y);
    doc.font('Helvetica-Bold').text('Order Date:', leftX, y + 14);
    doc.font('Helvetica').text(inv.date.toLocaleDateString('en-IN'), leftX + 88, y + 14);
    doc.font('Helvetica-Bold').text('Invoice Number:', leftX, y + 28);
    doc.font('Helvetica').text(inv.orderNumber, leftX + 88, y + 28);
    doc.font('Helvetica-Bold').text('Invoice Date:', leftX, y + 42);
    doc.font('Helvetica').text(inv.date.toLocaleDateString('en-IN'), leftX + 88, y + 42);

    // Right: Billing Address
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('Billing Address:', rightX, y, {
      width: colW,
      align: 'right',
    });
    doc.font('Helvetica').fontSize(9).fillColor('#333');
    doc.text(inv.customer.name, rightX, doc.y + 2, { width: colW, align: 'right' });
    if (inv.customer.address) doc.text(inv.customer.address, rightX, doc.y, { width: colW, align: 'right' });
    if (inv.customer.gstNumber) {
      doc.text(`GSTIN: ${inv.customer.gstNumber}`, rightX, doc.y, { width: colW, align: 'right' });
    }
    if (inv.placeOfSupply) {
      doc.text(`State/UT Code: ${inv.placeOfSupply.code}`, rightX, doc.y + 2, {
        width: colW,
        align: 'right',
      });
    }

    // Right: Shipping Address (same as billing in our flow — single ship-to per order)
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('Shipping Address:', rightX, doc.y + 8, {
      width: colW,
      align: 'right',
    });
    doc.font('Helvetica').fontSize(9).fillColor('#333');
    doc.text(inv.customer.name, rightX, doc.y + 2, { width: colW, align: 'right' });
    if (inv.customer.address) doc.text(inv.customer.address, rightX, doc.y, { width: colW, align: 'right' });
    if (inv.placeOfSupply) {
      doc.text(`State/UT Code: ${inv.placeOfSupply.code}`, rightX, doc.y + 2, {
        width: colW,
        align: 'right',
      });
      doc.font('Helvetica-Bold').text(`Place of supply: ${inv.placeOfSupply.name}`, rightX, doc.y + 2, {
        width: colW,
        align: 'right',
      });
      doc.text(`Place of delivery: ${inv.placeOfSupply.name}`, rightX, doc.y, {
        width: colW,
        align: 'right',
      });
    }

    const headerBlockEndY = Math.max(orderInfoY + 60, doc.y);
    y = headerBlockEndY + 14;
    doc.moveTo(leftX, y).lineTo(leftX + contentW, y).strokeColor('#CFC5A8').stroke();
    y += 8;

    // ── Items table ─────────────────────────────────────────────────
    const taxType = inv.isInterState ? 'IGST' : 'CGST+SGST';
    const cols = {
      sl:   { x: leftX,        w: 28,  label: 'Sl.\nNo.', align: 'left' as const },
      desc: { x: leftX + 32,   w: 200, label: 'Description', align: 'left' as const },
      rate: { x: leftX + 236,  w: 56,  label: 'Unit\nPrice', align: 'right' as const },
      qty:  { x: leftX + 296,  w: 26,  label: 'Qty', align: 'right' as const },
      net:  { x: leftX + 326,  w: 60,  label: 'Net\nAmount', align: 'right' as const },
      pct:  { x: leftX + 390,  w: 36,  label: 'Tax\nRate', align: 'right' as const },
      type: { x: leftX + 430,  w: 44,  label: 'Tax\nType', align: 'center' as const },
      tax:  { x: leftX + 478,  w: 50,  label: 'Tax\nAmount', align: 'right' as const },
      tot:  { x: leftX + 532,  w: 0,   label: 'Total\nAmount', align: 'right' as const },
    };
    cols.tot.w = leftX + contentW - cols.tot.x;
    const tableRight = leftX + contentW;

    // Header row
    doc.rect(leftX, y, contentW, 26).fillAndStroke('#F5F1EA', '#CFC5A8');
    doc.fillColor('#000').fontSize(8).font('Helvetica-Bold');
    Object.values(cols).forEach((c) => {
      doc.text(c.label, c.x + 2, y + 4, { width: c.w - 4, align: c.align });
    });
    y += 26;

    // Rows
    doc.font('Helvetica').fontSize(8).fillColor('#222');
    inv.items.forEach((it, i) => {
      // Each row's height depends on how long the description wraps.
      const descLines = doc.heightOfString(it.name, { width: cols.desc.w - 4 });
      const skuHsnH = 10; // for SKU + HSN sub-line
      const rowH = Math.max(descLines + skuHsnH + 6, 32);

      if (y + rowH > 760) {
        doc.addPage();
        y = PAGE_MARGIN;
      }

      // Sl. No.
      doc.font('Helvetica').fillColor('#222');
      doc.text(String(i + 1), cols.sl.x + 2, y + 4, { width: cols.sl.w - 4, align: cols.sl.align });

      // Description: product name + small SKU + HSN line below
      doc.text(it.name, cols.desc.x + 2, y + 4, { width: cols.desc.w - 4 });
      doc
        .fontSize(7)
        .fillColor('#777')
        .text(
          `SKU ${it.sku}${it.hsnCode ? ` · HSN ${it.hsnCode}` : ''}`,
          cols.desc.x + 2,
          y + 4 + descLines,
          { width: cols.desc.w - 4 },
        );

      // Numeric cells (reset font size)
      doc.fontSize(8).fillColor('#222').font('Helvetica');
      const cellTopY = y + 4;
      doc.text(inrPlain(it.unitPrice), cols.rate.x + 2, cellTopY, { width: cols.rate.w - 4, align: 'right' });
      doc.text(String(it.quantity), cols.qty.x + 2, cellTopY, { width: cols.qty.w - 4, align: 'right' });
      doc.text(inrPlain(it.taxableValue), cols.net.x + 2, cellTopY, { width: cols.net.w - 4, align: 'right' });
      doc.text(`${it.taxPercent}%`, cols.pct.x + 2, cellTopY, { width: cols.pct.w - 4, align: 'right' });
      doc.text(taxType, cols.type.x + 2, cellTopY, { width: cols.type.w - 4, align: 'center' });
      const lineTax = +(it.lineTotal - it.taxableValue).toFixed(2);
      doc.text(inrPlain(lineTax), cols.tax.x + 2, cellTopY, { width: cols.tax.w - 4, align: 'right' });
      doc.text(inrPlain(it.lineTotal), cols.tot.x + 2, cellTopY, { width: cols.tot.w - 4, align: 'right' });

      // Row separator
      doc.moveTo(leftX, y + rowH).lineTo(tableRight, y + rowH).strokeColor('#E8DEC0').stroke();
      y += rowH;
    });

    // ── Totals row ──────────────────────────────────────────────────
    doc.rect(leftX, y, contentW, 22).fillAndStroke('#F5F1EA', '#CFC5A8');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(9);
    doc.text('TOTAL:', cols.sl.x + 2, y + 6, { width: cols.qty.x + cols.qty.w - cols.sl.x - 4, align: 'left' });
    const totalTaxAmount = +inv.tax.toFixed(2);
    doc.text(inrPlain(totalTaxAmount), cols.tax.x + 2, y + 6, { width: cols.tax.w - 4, align: 'right' });
    doc.text(inrPlain(inv.total), cols.tot.x + 2, y + 6, { width: cols.tot.w - 4, align: 'right' });
    y += 30;

    // ── Tax breakdown ───────────────────────────────────────────────
    doc.font('Helvetica').fontSize(8).fillColor('#444');
    if (inv.isInterState) {
      doc.text(`IGST: ${inrPlain(inv.taxBreakdown.igst)}`, leftX, y);
    } else {
      doc.text(
        `CGST: ${inrPlain(inv.taxBreakdown.cgst)}   ·   SGST: ${inrPlain(inv.taxBreakdown.sgst)}`,
        leftX,
        y,
      );
    }
    if (inv.shipping > 0) {
      doc.text(`Shipping: ${inrPlain(inv.shipping)}`, leftX, doc.y + 2);
    }
    y = doc.y + 6;

    // ── Amount in words ─────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text('Amount in Words:', leftX, y);
    doc.font('Helvetica').fontSize(9).fillColor('#222').text(
      `${rupeeWords(inv.total)} only.`,
      leftX,
      doc.y + 2,
      { width: contentW * 0.7 },
    );

    // ── Signatory block (right) ─────────────────────────────────────
    const sigBlockY = y;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text(
      `For ${inv.company.name}:`,
      rightX,
      sigBlockY,
      { width: colW, align: 'right' },
    );
    // 30px space for handwritten signature
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('Authorized Signatory', rightX, sigBlockY + 50, {
      width: colW,
      align: 'right',
    });

    y = Math.max(doc.y, sigBlockY + 70) + 12;

    // ── Footer: reverse charge + declaration ────────────────────────
    doc.moveTo(leftX, y).lineTo(leftX + contentW, y).strokeColor('#CFC5A8').stroke();
    y += 6;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#222')
      .text('Whether tax is payable under reverse charge — No', leftX, y, { width: contentW });
    y = doc.y + 6;
    doc
      .fontSize(7)
      .fillColor('#777')
      .text(
        'Declaration: Goods once sold cannot be taken back without prior approval. Returns and refunds are subject to the policies published at kitchenarykart.com.',
        leftX,
        y,
        { width: contentW },
      );

    doc.end();
  });
}

/** Currency formatting with the rupee sign, Indian grouping. */
function inrPlain(n: number): string {
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

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
