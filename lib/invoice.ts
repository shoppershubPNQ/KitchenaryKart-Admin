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
import path from 'node:path';

/**
 * Roboto TTF font path — Roboto includes the ₹ (U+20B9) and full
 * Unicode currency block, which PDFKit's built-in Helvetica (WinAnsi
 * encoded) doesn't. We register it at the top of every render so
 * every text call can use 'Body' / 'Body-Bold' instead of Helvetica.
 *
 * The font files are pulled in via outputFileTracingIncludes in
 * next.config.js so Vercel's serverless trace includes them.
 */
const FONT_REGULAR = path.join(
  process.cwd(),
  'node_modules/roboto-fontface/fonts/Roboto/Roboto-Regular.ttf',
);
const FONT_BOLD = path.join(
  process.cwd(),
  'node_modules/roboto-fontface/fonts/Roboto/Roboto-Bold.ttf',
);

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
    /** Address printed in the Billing Address block. Falls back to
     *  shippingAddress when empty so the block never renders blank. */
    billingAddress?: string;
    /** Address printed in the Shipping Address block. Independent
     *  of billingAddress so B2B / gift-order flows where the two
     *  differ render correctly. */
    shippingAddress?: string;
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

    // Register Roboto under 'Body' / 'Body-Bold' aliases so the rest
    // of the renderer reads naturally. If the TTF can't be loaded for
    // any reason (e.g. running locally without the font installed),
    // fall back to PDFKit's built-in Helvetica — the layout will still
    // render, only the ₹ glyph will be missing.
    try {
      doc.registerFont('Body', FONT_REGULAR);
      doc.registerFont('Body-Bold', FONT_BOLD);
    } catch (e) {
      console.warn('[invoice] Roboto font load failed, falling back to Helvetica:', e);
      doc.registerFont('Body', 'Helvetica');
      doc.registerFont('Body-Bold', 'Helvetica-Bold');
    }

    const pageW = doc.page.width;
    const contentW = pageW - PAGE_MARGIN * 2;
    const colW = (contentW - COL_GAP) / 2;
    const leftX = PAGE_MARGIN;
    const rightX = PAGE_MARGIN + colW + COL_GAP;

    // ── Header: seller (left) + invoice declaration (right) ──────────
    let yTop = PAGE_MARGIN;
    doc.fontSize(18).fillColor('#A01818').font('Body-Bold').text(inv.company.name, leftX, yTop, {
      width: colW,
    });
    const sellerNameY = doc.y;
    doc.font('Body').fontSize(9).fillColor('#333');
    if (inv.company.address) doc.text(inv.company.address, leftX, sellerNameY + 4, { width: colW });
    if (inv.company.pan) doc.text(`PAN No: ${inv.company.pan}`, leftX, doc.y + 2, { width: colW });
    if (inv.company.gst) doc.text(`GST Registration No: ${inv.company.gst}`, leftX, doc.y, { width: colW });

    const leftHeaderEndY = doc.y;

    // Right column — invoice declaration
    doc.font('Body-Bold').fontSize(11).fillColor('#000').text(
      'Tax Invoice / Bill of Supply / Cash Memo',
      rightX,
      yTop + 4,
      { width: colW, align: 'right' },
    );
    doc.font('Body').fontSize(9).fillColor('#555').text('(Triplicate for Supplier)', rightX, doc.y, {
      width: colW,
      align: 'right',
    });

    yTop = Math.max(leftHeaderEndY, doc.y) + 14;
    doc.moveTo(leftX, yTop).lineTo(leftX + contentW, yTop).strokeColor('#CFC5A8').stroke();

    // ── Order info (left) + Billing/Shipping (right) ─────────────────
    let y = yTop + 10;
    const orderInfoY = y;

    doc.font('Body-Bold').fontSize(9).fillColor('#000').text('Order Number:', leftX, y);
    doc.font('Body').text(inv.orderNumber, leftX + 88, y);
    doc.font('Body-Bold').text('Order Date:', leftX, y + 14);
    doc.font('Body').text(inv.date.toLocaleDateString('en-IN'), leftX + 88, y + 14);
    doc.font('Body-Bold').text('Invoice Number:', leftX, y + 28);
    doc.font('Body').text(inv.orderNumber, leftX + 88, y + 28);
    doc.font('Body-Bold').text('Invoice Date:', leftX, y + 42);
    doc.font('Body').text(inv.date.toLocaleDateString('en-IN'), leftX + 88, y + 42);

    // Right: Billing Address.
    // Render only the address — the shippingAddress field is built
    // by the storefront as "<Name> · <Phone>\n<full address>" so the
    // name + phone already appear inline; rendering inv.customer.name
    // above it would print the name twice.
    const billingAddr = inv.customer.billingAddress || inv.customer.shippingAddress;
    const shippingAddr = inv.customer.shippingAddress || inv.customer.billingAddress;

    doc.font('Body-Bold').fontSize(10).fillColor('#000').text('Billing Address:', rightX, y, {
      width: colW,
      align: 'right',
    });
    doc.font('Body').fontSize(9).fillColor('#333');
    if (billingAddr) {
      doc.text(billingAddr, rightX, doc.y + 2, { width: colW, align: 'right' });
    } else {
      doc.text(inv.customer.name, rightX, doc.y + 2, { width: colW, align: 'right' });
    }
    if (inv.customer.gstNumber) {
      doc.text(`GSTIN: ${inv.customer.gstNumber}`, rightX, doc.y, { width: colW, align: 'right' });
    }
    if (inv.placeOfSupply) {
      doc.text(`State/UT Code: ${inv.placeOfSupply.code}`, rightX, doc.y + 2, {
        width: colW,
        align: 'right',
      });
    }

    // Right: Shipping Address — independent of billing so B2B and
    // gift-order flows where ship-to differs from bill-to render
    // correctly. When the order only has one address, both blocks
    // show the same value (which is fine).
    doc.font('Body-Bold').fontSize(10).fillColor('#000').text('Shipping Address:', rightX, doc.y + 8, {
      width: colW,
      align: 'right',
    });
    doc.font('Body').fontSize(9).fillColor('#333');
    if (shippingAddr) {
      doc.text(shippingAddr, rightX, doc.y + 2, { width: colW, align: 'right' });
    } else {
      doc.text(inv.customer.name, rightX, doc.y + 2, { width: colW, align: 'right' });
    }
    if (inv.placeOfSupply) {
      doc.text(`State/UT Code: ${inv.placeOfSupply.code}`, rightX, doc.y + 2, {
        width: colW,
        align: 'right',
      });
      doc.font('Body-Bold').text(`Place of supply: ${inv.placeOfSupply.name}`, rightX, doc.y + 2, {
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
    // 6 columns with vertical borders. Tax column stacks the amount,
    // rate %, and tax type (CGST+SGST or IGST) so the per-line tax
    // info is all visible without needing 3 separate columns.
    const taxType = inv.isInterState ? 'IGST' : 'CGST+SGST';
    const PAD = 5;
    const cols = {
      sl:   { x: leftX,        w: 28,  label: 'Sl.\nNo.', align: 'center' as const },
      desc: { x: leftX + 28,   w: 250, label: 'Description', align: 'left' as const },
      qty:  { x: leftX + 278,  w: 36,  label: 'Qty', align: 'center' as const },
      rate: { x: leftX + 314,  w: 60,  label: 'Unit Price', align: 'right' as const },
      tax:  { x: leftX + 374,  w: 80,  label: 'Tax', align: 'right' as const },
      tot:  { x: leftX + 454,  w: 69,  label: 'Total', align: 'right' as const },
    };
    const tableRight = leftX + contentW;
    const HEADER_H = 22;

    // Capture the table's top Y so we can draw the outer border + vertical
    // separators in one shot after all rows are rendered.
    const tableTopY = y;

    // Header row with background + bottom border
    doc.rect(leftX, y, contentW, HEADER_H).fillAndStroke('#1F1F1F', '#1F1F1F');
    doc.fillColor('#FFFFFF').fontSize(9).font('Body-Bold');
    Object.values(cols).forEach((c) => {
      doc.text(c.label, c.x + PAD, y + 6, { width: c.w - PAD * 2, align: c.align });
    });
    y += HEADER_H;
    const bodyTopY = y;

    // Rows
    doc.font('Body').fontSize(9).fillColor('#222');
    inv.items.forEach((it, i) => {
      // Row height driven by description wrap + SKU/HSN sub-lines
      doc.fontSize(9);
      const descNameH = doc.heightOfString(it.name, { width: cols.desc.w - PAD * 2 });
      const subLineH = it.hsnCode ? 22 : 11; // SKU line + HSN line if present
      const taxBlockH = 32; // amount + rate + type stacked
      const rowH = Math.max(descNameH + subLineH + PAD * 2, taxBlockH + PAD * 2, 40);

      if (y + rowH > 760) {
        doc.addPage();
        y = PAGE_MARGIN;
      }

      // Subtle alternating row tint to make rows easier to read
      if (i % 2 === 0) {
        doc.rect(leftX, y, contentW, rowH).fill('#FAF7EE');
      }
      doc.fillColor('#222');

      // Sl. No.
      doc.font('Body').fontSize(9).fillColor('#222').text(
        String(i + 1),
        cols.sl.x + PAD,
        y + PAD,
        { width: cols.sl.w - PAD * 2, align: cols.sl.align },
      );

      // Description: name (regular) + SKU (small grey) + HSN (small grey)
      doc.fontSize(9).fillColor('#1A1A1A').text(it.name, cols.desc.x + PAD, y + PAD, {
        width: cols.desc.w - PAD * 2,
      });
      const subY = y + PAD + descNameH + 1;
      doc.fontSize(7).fillColor('#777').text(`SKU: ${it.sku}`, cols.desc.x + PAD, subY, {
        width: cols.desc.w - PAD * 2,
      });
      if (it.hsnCode) {
        doc.text(`HSN: ${it.hsnCode}`, cols.desc.x + PAD, subY + 10, {
          width: cols.desc.w - PAD * 2,
        });
      }

      // Qty
      doc.fontSize(9).fillColor('#1A1A1A').text(String(it.quantity), cols.qty.x + PAD, y + PAD, {
        width: cols.qty.w - PAD * 2,
        align: cols.qty.align,
      });

      // Unit Price
      doc.text(inrPlain(it.unitPrice), cols.rate.x + PAD, y + PAD, {
        width: cols.rate.w - PAD * 2,
        align: cols.rate.align,
      });

      // Tax: amount (bold), rate (small), type (small)
      const lineTax = +(it.lineTotal - it.taxableValue).toFixed(2);
      doc.fontSize(9).font('Body-Bold').fillColor('#1A1A1A').text(
        inrPlain(lineTax),
        cols.tax.x + PAD,
        y + PAD,
        { width: cols.tax.w - PAD * 2, align: cols.tax.align },
      );
      doc.font('Body').fontSize(7).fillColor('#777').text(
        `${it.taxPercent}% ${taxType}`,
        cols.tax.x + PAD,
        y + PAD + 12,
        { width: cols.tax.w - PAD * 2, align: cols.tax.align },
      );

      // Total
      doc.font('Body-Bold').fontSize(9).fillColor('#1A1A1A').text(
        inrPlain(it.lineTotal),
        cols.tot.x + PAD,
        y + PAD,
        { width: cols.tot.w - PAD * 2, align: cols.tot.align },
      );

      // Row bottom border
      doc.moveTo(leftX, y + rowH).lineTo(tableRight, y + rowH).strokeColor('#D4C9B0').stroke();
      y += rowH;
    });

    // Draw vertical column separators across the body (between header
    // bottom and the last row), then the outer table border.
    const tableBottomY = y;
    doc.strokeColor('#D4C9B0').lineWidth(0.5);
    Object.values(cols).forEach((c, idx) => {
      if (idx === 0) return; // skip the very first edge — outer border draws it
      doc.moveTo(c.x, bodyTopY).lineTo(c.x, tableBottomY).stroke();
    });
    doc.strokeColor('#1F1F1F').lineWidth(0.8);
    doc.rect(leftX, tableTopY, contentW, tableBottomY - tableTopY).stroke();
    doc.lineWidth(1);

    // ── Totals row (separate, below the table) ──────────────────────
    y += 4;
    doc.rect(leftX, y, contentW, 24).fillAndStroke('#1F1F1F', '#1F1F1F');
    doc.fillColor('#FFFFFF').font('Body-Bold').fontSize(10);
    doc.text('TOTAL', leftX + PAD, y + 7, {
      width: cols.tax.x - leftX - PAD * 2,
      align: 'left',
    });
    const totalTaxAmount = +inv.tax.toFixed(2);
    doc.text(inrPlain(totalTaxAmount), cols.tax.x + PAD, y + 7, {
      width: cols.tax.w - PAD * 2,
      align: 'right',
    });
    doc.text(inrPlain(inv.total), cols.tot.x + PAD, y + 7, {
      width: cols.tot.w - PAD * 2,
      align: 'right',
    });
    y += 32;

    // ── Tax breakdown ───────────────────────────────────────────────
    doc.font('Body').fontSize(9).fillColor('#444');
    if (inv.isInterState) {
      doc.text(`IGST: ${inrPlain(inv.taxBreakdown.igst)}`, leftX, y, { width: contentW });
    } else {
      doc.text(
        `CGST: ${inrPlain(inv.taxBreakdown.cgst)}   ·   SGST: ${inrPlain(inv.taxBreakdown.sgst)}`,
        leftX,
        y,
        { width: contentW },
      );
    }
    if (inv.shipping > 0) {
      doc.text(`Shipping: ${inrPlain(inv.shipping)}`, leftX, doc.y + 2, { width: contentW });
    }
    y = doc.y + 10;

    // ── Amount in words + Signatory side-by-side ────────────────────
    // Constrain amount-in-words to the left half so long numbers
    // (e.g. ₹16,014.96 → "Sixteen Thousand...") wrap inside the
    // invoice instead of overflowing into the signatory area.
    const wordsBlockY = y;
    doc.font('Body-Bold').fontSize(9).fillColor('#000').text('Amount in Words:', leftX, wordsBlockY, {
      width: colW,
    });
    doc.font('Body').fontSize(9).fillColor('#222').text(
      `${rupeeWords(inv.total)} only.`,
      leftX,
      doc.y + 2,
      { width: colW, lineGap: 1 },
    );
    const wordsEndY = doc.y;

    // Signatory on the right
    doc.font('Body-Bold').fontSize(10).fillColor('#000').text(
      `For ${inv.company.name}:`,
      rightX,
      wordsBlockY,
      { width: colW, align: 'right' },
    );
    doc.font('Body-Bold').fontSize(10).fillColor('#000').text(
      'Authorized Signatory',
      rightX,
      wordsBlockY + 50,
      { width: colW, align: 'right' },
    );

    y = Math.max(wordsEndY, wordsBlockY + 70) + 12;

    // ── Footer: reverse charge + declaration ────────────────────────
    doc.moveTo(leftX, y).lineTo(leftX + contentW, y).strokeColor('#CFC5A8').stroke();
    y += 6;
    doc
      .font('Body')
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
  parts.push(`${numberToIndianWords(rupees)} Rupee${rupees === 1 ? '' : 's'}`);
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
