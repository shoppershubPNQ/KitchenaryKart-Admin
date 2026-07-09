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
import { ROBOTO_REGULAR_B64, ROBOTO_BOLD_B64 } from './roboto-embedded';
import { STAMP_PNG_B64 } from './stamp-embedded';

/**
 * Roboto TTF fonts — Roboto includes the ₹ (U+20B9) and full Unicode
 * currency block, which PDFKit's built-in Helvetica (WinAnsi encoded)
 * doesn't. We register them at the top of every render so all text
 * calls can use 'Body' / 'Body-Bold' instead of Helvetica.
 *
 * The TTF binaries live in admin/assets/fonts/ (committed to the repo,
 * Apache 2.0 from googlefonts/roboto), and scripts/embed-font.cjs
 * base64-encodes them into this file at install/build time. Embedding
 * inside the JS bundle is the only way to guarantee they ship inside
 * the Vercel serverless function — outputFileTracingIncludes wasn't
 * reliable for these binary assets, and roboto-fontface / @fontsource
 * both ship only .woff/.woff2 (which PDFKit cannot read).
 */
const FONT_REGULAR_BUFFER =
  ROBOTO_REGULAR_B64.length > 0 ? Buffer.from(ROBOTO_REGULAR_B64, 'base64') : null;
const FONT_BOLD_BUFFER =
  ROBOTO_BOLD_B64.length > 0 ? Buffer.from(ROBOTO_BOLD_B64, 'base64') : null;

// Company seal/stamp drawn over the signatory line on every invoice.
// Optional — null when assets/stamp.png hasn't been embedded yet, in
// which case the invoice renders exactly as before (no stamp).
const STAMP_BUFFER =
  STAMP_PNG_B64.length > 0 ? Buffer.from(STAMP_PNG_B64, 'base64') : null;

import type { OrderSummary } from './order-summary';

export interface InvoiceInput {
  /** Customer-facing order ref (e.g. "KKMPDPIVW8") — the storefront's
   *  identifier. Distinct from the GST invoice number below. */
  orderNumber: string;
  /** GST invoice serial in `KK/<FY>/<padded>` form (e.g.
   *  "KK/2026-27/0001"). Required for GST compliance — see Rule 46(b).
   *  Allocated lazily in lib/invoice-serial.ts. For an unpaid order this is
   *  a proforma reference (no serial) and `proforma` is set. */
  invoiceNumber: string;
  /** True when the order isn't paid yet → render as a Proforma Invoice with
   *  no GST serial (so unpaid orders never consume a tax-invoice number). */
  proforma?: boolean;
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
  taxBreakdown: { cgst: number; sgst: number; igst: number };
  /** The full price breakdown (per-line + totals) from the shared helper —
   *  same numbers + labels as the website, admin and print view. GST is on
   *  the discounted net value. */
  summary: OrderSummary;
}

const PAGE_MARGIN = 36;
const COL_GAP = 16;
// A4 in PDFKit points = 595.28 × 841.89. We stop drawing rows at this Y
// so the per-page "Page X of Y" footer + bottom margin always have room.
const PAGE_ROW_LIMIT_Y = 770;
// Vertical space the totals + amount-in-words + signatory + footer
// block needs at the bottom of the last page. Used to decide whether
// to push the totals to a fresh page after the items table ends.
const FOOTER_RESERVE = 270;

export async function renderInvoicePdf(inv: InvoiceInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // bufferPages lets us go back to earlier pages after the layout
    // is done to draw per-page verticals/borders and the "Page X of Y"
    // footer. Without it, switchToPage() throws.
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true });
    const buffers: Buffer[] = [];
    doc.on('data', (b: Buffer) => buffers.push(b));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    // Register Roboto under 'Body' / 'Body-Bold' aliases so the rest
    // of the renderer reads naturally. Falls back to Helvetica only as
    // a last resort (the embed script now fails the build if the TTFs
    // are missing, so this branch should be unreachable in practice).
    if (FONT_REGULAR_BUFFER && FONT_BOLD_BUFFER) {
      doc.registerFont('Body', FONT_REGULAR_BUFFER);
      doc.registerFont('Body-Bold', FONT_BOLD_BUFFER);
    } else {
      console.error('[invoice] Roboto buffers empty — Helvetica fallback, ₹ glyph will be missing');
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

    // Right column — invoice declaration. Unpaid orders render as a PROFORMA
    // (no GST serial burned) so the document isn't passed off as a real tax
    // invoice for a sale that hasn't been paid for.
    doc.font('Body-Bold').fontSize(11).fillColor('#000').text(
      inv.proforma ? 'Proforma Invoice' : 'Tax Invoice / Bill of Supply / Cash Memo',
      rightX,
      yTop + 4,
      { width: colW, align: 'right' },
    );
    doc.font('Body').fontSize(9).fillColor('#555').text(
      inv.proforma ? '(Not a tax invoice — payment pending)' : '(Triplicate for Supplier)',
      rightX,
      doc.y,
      { width: colW, align: 'right' },
    );

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
    doc.font('Body').text(inv.invoiceNumber, leftX + 88, y + 28);
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
    //
    // Multi-page handling: when a row would overflow PAGE_ROW_LIMIT_Y,
    // we record the current page's table extent, start a new page,
    // redraw the table header, and continue. After all rows are
    // rendered, we revisit each page (bufferedPages) to draw the
    // vertical column separators and outer table border per page.
    const PAD = 5;
    // Proportional widths (≈ % of contentW) so columns stay compact and
    // balanced — no large blank gap after the description. Sl 5 · Desc 35 ·
    // Qty 8 · Unit Price 18 · Discount 14 · GST 10 · Total 10.
    const cols = {
      sl:   { x: leftX,        w: 26,  label: 'Sl.', align: 'center' as const },
      desc: { x: leftX + 26,   w: 183, label: 'Description', align: 'left' as const },
      qty:  { x: leftX + 209,  w: 42,  label: 'Qty', align: 'center' as const },
      unit: { x: leftX + 251,  w: 94,  label: 'Unit Price', align: 'right' as const },
      disc: { x: leftX + 345,  w: 73,  label: 'Discount', align: 'right' as const },
      gst:  { x: leftX + 418,  w: 52,  label: 'GST', align: 'right' as const },
      tot:  { x: leftX + 470,  w: 53,  label: 'Total', align: 'right' as const },
    };
    const tableRight = leftX + contentW;
    const HEADER_H = 22;

    // Per-page table bounds, populated as we lay out rows. Used after
    // the items loop to draw verticals + outer border on each page.
    const tablePages: Array<{
      pageIdx: number;
      tableTopY: number;
      bodyTopY: number;
      bodyBottomY: number;
    }> = [];

    const drawTableHeaderAt = (yPos: number): number => {
      doc.rect(leftX, yPos, contentW, HEADER_H).fillAndStroke('#1F1F1F', '#1F1F1F');
      doc.fillColor('#FFFFFF').fontSize(9).font('Body-Bold');
      Object.values(cols).forEach((c) => {
        // `height` is critical — without it, PDFKit's line-wrapper will
        // call addPage() itself when the cell text wraps near the page
        // bottom, breaking our own pagination logic.
        doc.text(c.label, c.x + PAD, yPos + 6, {
          width: c.w - PAD * 2,
          height: HEADER_H,
          align: c.align,
        });
      });
      return yPos + HEADER_H;
    };

    // Open the first page's table section
    let currentTable = {
      pageIdx: doc.bufferedPageRange().count - 1,
      tableTopY: y,
      bodyTopY: drawTableHeaderAt(y),
      bodyBottomY: 0,
    };
    y = currentTable.bodyTopY;

    // Rows
    doc.font('Body').fontSize(9).fillColor('#222');
    inv.summary.lines.forEach((it, i) => {
      // Row height driven by the (fully wrapped) description + sub-lines.
      doc.fontSize(9);
      const descNameH = doc.heightOfString(it.name, { width: cols.desc.w - PAD * 2 });
      const subLineH = it.hsnCode ? 22 : 11; // SKU line + optional HSN line
      const rowH = Math.max(descNameH + subLineH + PAD * 2, 34);

      if (y + rowH > PAGE_ROW_LIMIT_Y) {
        currentTable.bodyBottomY = y;
        tablePages.push(currentTable);
        doc.addPage();
        const newTop = PAGE_MARGIN;
        const newBodyTop = drawTableHeaderAt(newTop);
        currentTable = {
          pageIdx: doc.bufferedPageRange().count - 1,
          tableTopY: newTop,
          bodyTopY: newBodyTop,
          bodyBottomY: 0,
        };
        y = newBodyTop;
      }

      if (i % 2 === 0) {
        doc.rect(leftX, y, contentW, rowH).fill('#FAF7EE');
      }
      doc.fillColor('#222');
      // lineBreak:false + height keep cells single-line (or truncate) so
      // PDFKit's wrapper never triggers its own pagination — see the
      // original note in git history.
      const cellOpts = { lineBreak: false as const, height: rowH };

      // Sl.
      doc.font('Body').fontSize(9).fillColor('#222').text(
        String(i + 1), cols.sl.x + PAD, y + PAD,
        { width: cols.sl.w - PAD * 2, align: cols.sl.align, ...cellOpts },
      );

      // Description: full wrapped name + SKU (+ HSN)
      doc.fontSize(9).fillColor('#1A1A1A').text(it.name, cols.desc.x + PAD, y + PAD, {
        width: cols.desc.w - PAD * 2,
        height: rowH,
      });
      const subY = y + PAD + descNameH + 1;
      doc.fontSize(7).fillColor('#777').text(`SKU: ${it.sku}`, cols.desc.x + PAD, subY, {
        width: cols.desc.w - PAD * 2, ...cellOpts,
      });
      if (it.hsnCode) {
        doc.text(`HSN: ${it.hsnCode}`, cols.desc.x + PAD, subY + 10, {
          width: cols.desc.w - PAD * 2, ...cellOpts,
        });
      }

      // Qty
      doc.font('Body').fontSize(9).fillColor('#1A1A1A').text(
        String(it.quantity), cols.qty.x + PAD, y + PAD,
        { width: cols.qty.w - PAD * 2, align: cols.qty.align, ...cellOpts },
      );

      // Unit Price (excl. GST)
      doc.text(inrPlain(it.unitNetPrice), cols.unit.x + PAD, y + PAD, {
        width: cols.unit.w - PAD * 2, align: cols.unit.align, ...cellOpts,
      });

      // Discount (ex-GST amount, no minus sign; — when none)
      doc.fillColor(it.lineDiscount > 0 ? '#0A7D33' : '#777').text(
        it.lineDiscount > 0 ? inrPlain(it.lineDiscount) : '—',
        cols.disc.x + PAD, y + PAD,
        { width: cols.disc.w - PAD * 2, align: cols.disc.align, ...cellOpts },
      );

      // GST: amount (on discounted value) + small rate
      doc.fillColor('#1A1A1A').fontSize(9).text(inrPlain(it.lineGst), cols.gst.x + PAD, y + PAD, {
        width: cols.gst.w - PAD * 2, align: cols.gst.align, ...cellOpts,
      });
      doc.fontSize(7).fillColor('#777').text(`${it.taxPercent}%`, cols.gst.x + PAD, y + PAD + 11, {
        width: cols.gst.w - PAD * 2, align: cols.gst.align, ...cellOpts,
      });

      // Total (Net Value + GST)
      doc.font('Body-Bold').fontSize(9).fillColor('#1A1A1A').text(
        inrPlain(it.lineTotal), cols.tot.x + PAD, y + PAD,
        { width: cols.tot.w - PAD * 2, align: cols.tot.align, ...cellOpts },
      );

      doc.moveTo(leftX, y + rowH).lineTo(tableRight, y + rowH).strokeColor('#D4C9B0').stroke();
      y += rowH;
    });

    // Close the final page's table extent
    currentTable.bodyBottomY = y;
    tablePages.push(currentTable);

    // Draw verticals + outer border per page. We do this in a second
    // pass so the rectangles don't paint over rows on subsequent
    // pages and the extents are known for sure.
    const lastTablePageIdx = currentTable.pageIdx;
    tablePages.forEach((ext) => {
      doc.switchToPage(ext.pageIdx);
      doc.strokeColor('#D4C9B0').lineWidth(0.5);
      Object.values(cols).forEach((c, idx) => {
        if (idx === 0) return; // outer border draws the leftmost edge
        doc.moveTo(c.x, ext.bodyTopY).lineTo(c.x, ext.bodyBottomY).stroke();
      });
      doc.strokeColor('#1F1F1F').lineWidth(0.8);
      doc.rect(leftX, ext.tableTopY, contentW, ext.bodyBottomY - ext.tableTopY).stroke();
    });
    doc.lineWidth(1);

    // Continue drawing on whichever page the items table ended on
    doc.switchToPage(lastTablePageIdx);

    // If the totals + signatory block wouldn't fit on the current
    // page, push it to a fresh page so nothing gets clipped.
    if (y + FOOTER_RESERVE > PAGE_ROW_LIMIT_Y) {
      doc.addPage();
      y = PAGE_MARGIN;
    }

    // ── Summary (right-aligned rows, aligned to the table columns) ───
    // Reads as a continuation of the items table: the GST split and the
    // coupon discount are laid out as label→value rows under the amount
    // columns, ending in a bold Net Payable bar — so the lower total is
    // fully explained instead of looking like an unexplained number.
    y += 6;
    const s = inv.summary;
    const sumLabelX = leftX + PAD;
    const sumLabelW = cols.gst.x - leftX - PAD * 2;
    const sumValX = cols.gst.x;
    const sumValW = tableRight - cols.gst.x - PAD;
    const sumRow = (
      label: string,
      value: string,
      o: { bold?: boolean; color?: string } = {},
    ) => {
      const h = 17;
      doc.font(o.bold ? 'Body-Bold' : 'Body').fontSize(9).fillColor(o.color || '#333');
      doc.text(label, sumLabelX, y + 4, { width: sumLabelW, align: 'right', lineBreak: false, height: h });
      doc.text(value, sumValX, y + 4, { width: sumValW, align: 'right', lineBreak: false, height: h });
      y += h;
    };
    // GST-compliant ladder — identical labels + numbers across website,
    // admin and print. GST is on the discounted Net Value.
    sumRow('Excluding GST Price (Net Price)', inrPlain(s.netPrice));
    if (s.discountPct > 0) {
      sumRow(`Discount (${s.discountPct}%)`, `- ${inrPlain(s.discountAmount)}`, { color: '#0A7D33' });
    }
    if (s.discountPct > 0) {
      sumRow('Net Value', inrPlain(s.netValue));
    }
    sumRow(`Shipping Fee${s.shipping === 0 ? ' (Free)' : ''}`, inrPlain(s.shipping));
    sumRow(`GST (${s.gstRateLabel})`, inrPlain(s.gstAmount));
    if (s.roundOff !== 0) {
      sumRow('Round Off', `${s.roundOff > 0 ? '+ ' : '- '}${inrPlain(Math.abs(s.roundOff))}`);
    }
    // Net Payable Amount — bold black bar.
    y += 3;
    doc.rect(leftX, y, contentW, 26).fillAndStroke('#1F1F1F', '#1F1F1F');
    doc.fillColor('#FFFFFF').font('Body-Bold').fontSize(11);
    doc.text('Net Payable Amount', sumLabelX, y + 7, { width: sumLabelW, align: 'right', lineBreak: false, height: 26 });
    doc.text(inrPlain(s.netPayable), sumValX, y + 7, { width: sumValW, align: 'right', lineBreak: false, height: 26 });
    y += 36;
    doc.fillColor('#444');

    // ── Amount in words + Signatory side-by-side ────────────────────
    // Constrain amount-in-words to the left half so long numbers
    // (e.g. ₹16,014.96 → "Sixteen Thousand...") wrap inside the
    // invoice instead of overflowing into the signatory area.
    const wordsBlockY = y;
    doc.font('Body-Bold').fontSize(9).fillColor('#000').text('Amount in Words:', leftX, wordsBlockY, {
      width: colW,
    });
    doc.font('Body').fontSize(9).fillColor('#222').text(
      `${rupeeWords(inv.summary.netPayable)} only.`,
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
    // Company seal/stamp over the signatory line (auto on every invoice
    // once assets/stamp.png is embedded). Wrapped in try/catch so a bad
    // image can never break invoice generation on the live payment path.
    if (STAMP_BUFFER) {
      const stampSize = 66;
      try {
        doc.image(STAMP_BUFFER, rightX + colW - stampSize, wordsBlockY + 12, {
          fit: [stampSize, stampSize],
        });
      } catch (e) {
        console.error('[invoice] stamp image failed to render — skipping', e);
      }
    }
    doc.font('Body-Bold').fontSize(10).fillColor('#000').text(
      'Authorized Signatory',
      rightX,
      wordsBlockY + (STAMP_BUFFER ? 84 : 50),
      { width: colW, align: 'right' },
    );

    y = Math.max(wordsEndY, wordsBlockY + (STAMP_BUFFER ? 104 : 70)) + 12;

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

    // ── Per-page footer: invoice number (left) + "Page X of Y" (right)
    // Runs after all content is laid out so we know the final page
    // count. `lineBreak: false` is critical here: footerY sits ~20pt
    // above page bottom, and without it PDFKit's wrap check thinks
    // the text might overflow and auto-adds a new page — which would
    // then itself need a footer and cascade endlessly.
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const footerY = doc.page.height - 22;
      doc.font('Body').fontSize(7).fillColor('#999');
      doc.text(inv.invoiceNumber, PAGE_MARGIN, footerY, {
        width: contentW / 2,
        align: 'left',
        height: 20,
        lineBreak: false,
      });
      doc.text(`Page ${i + 1} of ${range.count}`, PAGE_MARGIN + contentW / 2, footerY, {
        width: contentW / 2,
        align: 'right',
        height: 20,
        lineBreak: false,
      });
    }

    doc.end();
  });
}

/** Currency formatting with the rupee sign, Indian grouping. Always shows
 *  exactly 2 decimals (e.g. ₹325.00, ₹16.25) for tax-invoice consistency. */
function inrPlain(n: number): string {
  return '₹' + Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
