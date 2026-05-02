/** Simple PDF invoice generator using PDFKit. Streams bytes so it can be returned from a Next.js route. */
import PDFDocument from 'pdfkit';

export interface InvoiceItem {
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  taxPercent: number;
  lineTotal: number;
}

export interface InvoiceInput {
  orderNumber: string;
  date: Date;
  company: { name: string; gst?: string };
  customer: { name: string; email?: string; phone?: string; address?: string; gstNumber?: string };
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
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

    // Header
    doc.fontSize(20).fillColor('#A01818').text(inv.company.name, { align: 'left' });
    if (inv.company.gst) doc.fontSize(9).fillColor('#666').text(`GSTIN: ${inv.company.gst}`);
    doc.moveDown();

    doc.fontSize(16).fillColor('#000').text('TAX INVOICE', { align: 'right' });
    doc.fontSize(10).text(`Invoice: ${inv.orderNumber}`, { align: 'right' });
    doc.text(`Date: ${inv.date.toLocaleDateString('en-IN')}`, { align: 'right' });
    doc.moveDown(2);

    // Bill to
    doc.fontSize(11).fillColor('#000').text('Bill to:', { continued: false });
    doc.fontSize(10).fillColor('#333').text(inv.customer.name);
    if (inv.customer.email) doc.text(inv.customer.email);
    if (inv.customer.phone) doc.text(inv.customer.phone);
    if (inv.customer.address) doc.text(inv.customer.address);
    if (inv.customer.gstNumber) doc.text(`GSTIN: ${inv.customer.gstNumber}`);
    doc.moveDown();

    // Items table
    const tableTop = doc.y + 10;
    const cols = { sku: 50, name: 120, qty: 340, unit: 390, tax: 450, total: 500 };
    doc.fontSize(10).fillColor('#000');
    doc.text('SKU', cols.sku, tableTop);
    doc.text('Item', cols.name, tableTop);
    doc.text('Qty', cols.qty, tableTop);
    doc.text('Unit', cols.unit, tableTop);
    doc.text('GST%', cols.tax, tableTop);
    doc.text('Total', cols.total, tableTop);
    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

    let y = tableTop + 22;
    for (const it of inv.items) {
      doc.fontSize(9).fillColor('#333');
      doc.text(it.sku, cols.sku, y, { width: 60, ellipsis: true });
      doc.text(it.name, cols.name, y, { width: 210, ellipsis: true });
      doc.text(String(it.quantity), cols.qty, y);
      doc.text(inr(it.unitPrice), cols.unit, y);
      doc.text(String(it.taxPercent), cols.tax, y);
      doc.text(inr(it.lineTotal), cols.total, y);
      y += 18;
      if (y > 720) {
        doc.addPage();
        y = 50;
      }
    }

    doc.moveTo(50, y + 5).lineTo(550, y + 5).stroke();
    y += 15;

    doc.fontSize(10).fillColor('#000');
    doc.text(`Subtotal: ${inr(inv.subtotal)}`, 400, y);
    y += 15;
    doc.text(`GST: ${inr(inv.tax)}`, 400, y);
    y += 15;
    doc.text(`Shipping: ${inr(inv.shipping)}`, 400, y);
    y += 15;
    doc.fontSize(12).fillColor('#A01818').text(`Total: ${inr(inv.total)}`, 400, y);

    doc.end();
  });
}

function inr(n: number): string {
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
