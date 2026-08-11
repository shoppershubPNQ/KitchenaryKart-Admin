/**
 * Credit note PDF — the document the accountant files and the customer keeps.
 *
 * Deliberately a separate renderer from the invoice rather than a flag on it:
 * a credit note is its own tax document, must be titled as one, and must carry
 * the ORIGINAL invoice's number and date on its face. Rule 53 of the CGST Rules
 * requires that reference; without it the note cannot be matched to the supply
 * it reverses.
 *
 * Uses the same embedded Roboto as the invoice — the built-in PDF fonts have no
 * ₹ glyph, which is why the fonts are shipped in the repo rather than pulled
 * from npm.
 */
import PDFDocument from 'pdfkit';
import { ROBOTO_REGULAR_B64, ROBOTO_BOLD_B64 } from './roboto-embedded';
import { prisma } from './db';
import { formatCreditNoteNumber } from './credit-note';

const FONT_REGULAR = Buffer.from(ROBOTO_REGULAR_B64, 'base64');
const FONT_BOLD = Buffer.from(ROBOTO_BOLD_B64, 'base64');

const BRAND = '#9E2A2B';
const INK = '#1A1A1A';
const MUTED = '#666666';
const LINE = '#D8D2C8';

const inr = (n: number) =>
  '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

async function setting(key: string, fallback: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  return (row?.value as string) || fallback;
}

export async function renderCreditNotePdf(creditNoteId: number): Promise<{ pdf: Buffer; number: string } | null> {
  const cn = await prisma.creditNote.findUnique({
    where: { id: creditNoteId },
    include: { order: { select: { orderNumber: true, shippingAddress: true, customerEmail: true, customerPhone: true } } },
  });
  if (!cn) return null;

  const [companyName, companyGst, companyPan, companyAddress, companyState] = await Promise.all([
    setting('company_name', 'Kitchenary Kart'),
    setting('company_gst', '27AAQPR2976J1ZU'),
    setting('company_pan', 'AAQPR2976J'),
    setting('company_address', 'Pune, Maharashtra'),
    setting('company_state', 'Maharashtra'),
  ]);

  const number = formatCreditNoteNumber(cn.financialYear, cn.serial);
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.registerFont('R', FONT_REGULAR);
  doc.registerFont('B', FONT_BOLD);

  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c as Buffer));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  const M = 42;
  const W = 595.28;
  const CW = W - M * 2;

  // ── Header ────────────────────────────────────────────────────────────
  doc.rect(0, 0, W, 92).fill(BRAND);
  doc.font('B').fontSize(19).fillColor('#FFFFFF')
    .text(companyName, M, 22, { width: CW - 200, lineBreak: false, height: 24 });
  doc.font('R').fontSize(8.5).fillColor('#F3DCDC')
    .text(companyAddress, M, 46, { width: CW - 210, height: 22 });
  doc.font('B').fontSize(16).fillColor('#FFFFFF')
    .text('CREDIT NOTE', W - M - 200, 24, { width: 200, align: 'right', lineBreak: false, height: 20 });
  doc.font('R').fontSize(8.5).fillColor('#F3DCDC')
    .text('Issued under Section 34, CGST Act', W - M - 200, 46, { width: 200, align: 'right', lineBreak: false, height: 12 });

  let y = 110;
  doc.font('R').fontSize(8.5).fillColor(MUTED)
    .text(`GSTIN: ${companyGst}    PAN: ${companyPan}    State: ${companyState} (27)`, M, y, { width: CW, height: 12, lineBreak: false });
  y += 22;

  // ── Note identity + the invoice it reverses ───────────────────────────
  doc.rect(M, y, CW, 62).fill('#FAF7F1');
  const col = CW / 2;
  doc.font('R').fontSize(8).fillColor(MUTED).text('CREDIT NOTE NO.', M + 12, y + 10, { width: col - 24, height: 10, lineBreak: false });
  doc.font('B').fontSize(11).fillColor(INK).text(number, M + 12, y + 22, { width: col - 24, height: 14, lineBreak: false });
  doc.font('R').fontSize(8).fillColor(MUTED).text('DATE', M + 12, y + 40, { width: col - 24, height: 10, lineBreak: false });
  doc.font('R').fontSize(9).fillColor(INK).text(dmy(cn.issuedAt), M + 70, y + 40, { width: col - 82, height: 10, lineBreak: false });

  doc.font('R').fontSize(8).fillColor(MUTED).text('AGAINST ORIGINAL INVOICE', M + col + 12, y + 10, { width: col - 24, height: 10, lineBreak: false });
  doc.font('B').fontSize(11).fillColor(INK).text(cn.invoiceNumber, M + col + 12, y + 22, { width: col - 24, height: 14, lineBreak: false });
  doc.font('R').fontSize(8).fillColor(MUTED).text('INVOICE DATE', M + col + 12, y + 40, { width: col - 24, height: 10, lineBreak: false });
  doc.font('R').fontSize(9).fillColor(INK).text(dmy(cn.invoiceDate), M + col + 82, y + 40, { width: col - 94, height: 10, lineBreak: false });
  y += 78;

  // ── Recipient ─────────────────────────────────────────────────────────
  doc.font('B').fontSize(9).fillColor(BRAND).text('CREDIT TO', M, y, { width: CW, height: 12, lineBreak: false });
  y += 15;
  doc.font('B').fontSize(10.5).fillColor(INK).text(cn.customerName || '—', M, y, { width: CW - 200, height: 14, lineBreak: false });
  y += 15;
  if (cn.customerGstin) {
    doc.font('R').fontSize(9).fillColor(INK).text(`GSTIN: ${cn.customerGstin}`, M, y, { width: CW - 200, height: 12, lineBreak: false });
    y += 13;
  }
  if (cn.order?.shippingAddress) {
    doc.font('R').fontSize(8.5).fillColor(MUTED).text(cn.order.shippingAddress.replace(/\s*\n\s*/g, ', '), M, y, { width: CW - 200, height: 26 });
    y += 28;
  }
  doc.font('R').fontSize(8.5).fillColor(MUTED)
    .text(`Place of supply: ${cn.placeOfSupply || '—'}${cn.placeOfSupplyCode ? ` (${cn.placeOfSupplyCode})` : ''}`,
      M, y, { width: CW, height: 12, lineBreak: false });
  y += 14;
  doc.font('R').fontSize(8.5).fillColor(MUTED)
    .text(`Reason: ${cn.reason}${cn.order?.orderNumber ? `    ·    Order ${cn.order.orderNumber}` : ''}`,
      M, y, { width: CW, height: 12, lineBreak: false });
  y += 24;

  // ── Amounts ───────────────────────────────────────────────────────────
  const rows: Array<[string, string, boolean]> = [
    ['Taxable value credited', inr(Number(cn.taxableValue)), false],
  ];
  if (Number(cn.cgst) > 0) rows.push(['CGST', inr(Number(cn.cgst)), false]);
  if (Number(cn.sgst) > 0) rows.push(['SGST', inr(Number(cn.sgst)), false]);
  if (Number(cn.igst) > 0) rows.push(['IGST', inr(Number(cn.igst)), false]);
  const taxSum = Number(cn.cgst) + Number(cn.sgst) + Number(cn.igst);
  const roundOff = Math.round((Number(cn.totalAmount) - Number(cn.taxableValue) - taxSum) * 100) / 100;
  if (Math.abs(roundOff) >= 0.01) rows.push(['Round off', inr(roundOff), false]);
  rows.push(['TOTAL CREDITED', inr(Number(cn.totalAmount)), true]);

  doc.rect(M, y, CW, 22).fill(BRAND);
  doc.font('B').fontSize(9).fillColor('#FFFFFF').text('PARTICULARS', M + 12, y + 7, { width: CW - 140, height: 12, lineBreak: false });
  doc.font('B').fontSize(9).fillColor('#FFFFFF').text('AMOUNT', W - M - 120, y + 7, { width: 108, align: 'right', height: 12, lineBreak: false });
  y += 22;

  rows.forEach(([label, value, bold], i) => {
    const h = bold ? 28 : 22;
    if (bold) doc.rect(M, y, CW, h).fill('#FAF7F1');
    else if (i % 2 === 0) doc.rect(M, y, CW, h).fill('#FCFBF9');
    doc.font(bold ? 'B' : 'R').fontSize(bold ? 11 : 9.5).fillColor(bold ? BRAND : INK)
      .text(label, M + 12, y + (bold ? 9 : 6), { width: CW - 140, height: 14, lineBreak: false });
    doc.font(bold ? 'B' : 'R').fontSize(bold ? 11 : 9.5).fillColor(bold ? BRAND : INK)
      .text(value, W - M - 120, y + (bold ? 9 : 6), { width: 108, align: 'right', height: 14, lineBreak: false });
    doc.moveTo(M, y + h).lineTo(M + CW, y + h).lineWidth(0.4).strokeColor(LINE).stroke();
    y += h;
  });

  y += 22;
  if (cn.notes) {
    doc.font('R').fontSize(8.5).fillColor(MUTED).text(`Note: ${cn.notes}`, M, y, { width: CW, height: 24 });
    y += 28;
  }

  doc.font('R').fontSize(8).fillColor(MUTED)
    .text('This credit note reduces the tax liability for the month in which it is issued. The original invoice referenced above remains valid and filed in its own period.',
      M, y, { width: CW, height: 28 });

  // Signature block, bottom right.
  doc.font('R').fontSize(8.5).fillColor(MUTED)
    .text(`For ${companyName}`, W - M - 200, 700, { width: 200, align: 'right', height: 12, lineBreak: false });
  doc.moveTo(W - M - 160, 748).lineTo(W - M, 748).lineWidth(0.5).strokeColor(LINE).stroke();
  doc.font('R').fontSize(8).fillColor(MUTED)
    .text('Authorised signatory', W - M - 200, 754, { width: 200, align: 'right', height: 12, lineBreak: false });

  doc.font('R').fontSize(7.5).fillColor(MUTED)
    .text('Computer-generated credit note.', M, 754, { width: 260, height: 12, lineBreak: false });

  doc.end();
  return { pdf: await done, number };
}
