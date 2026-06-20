/**
 * Local smoke test for the multi-page invoice renderer.
 * Run: npx tsx scripts/test-invoice-multipage.ts
 * Output: scripts/invoice-multipage-test.pdf
 */
import path from 'node:path';
import fs from 'node:fs';
import { renderInvoicePdf } from '../lib/invoice';
import { computeOrderSummary } from '../lib/order-summary';

const ITEM_COUNT = parseInt(process.env.ITEMS || '30');
const summary = computeOrderSummary(
  Array.from({ length: ITEM_COUNT }, (_, i) => ({
    name: `Product ${i + 1}`,
    sku: `KK${String(i + 1).padStart(4, '0')}`,
    hsnCode: '84198190',
    lineInclusive: 1180,
    quantity: 1,
    taxPercent: 18,
  })),
  0,
  0,
);

renderInvoicePdf({
  orderNumber: 'KKTEST0001',
  invoiceNumber: 'KK/2026-27/0099',
  date: new Date('2026-05-20'),
  company: {
    name: 'Kitchenary Kart',
    gst: '27AAQPR2976J1ZU',
    pan: 'AAQPR2976J',
    address: 'A2/103, Parshwanagar, Opp. Swami Vivekanand Garden,\nKondhwa Budruk, Pune-411048\nMaharashtra, India',
    state: 'Maharashtra',
    stateCode: '27',
  },
  customer: {
    name: 'Test Customer Pvt Ltd',
    email: 'test@example.com',
    billingAddress: 'Test Customer Pvt Ltd · +911234567890\n123 Test Street, Mumbai 400001\nMaharashtra',
    shippingAddress: 'Test Customer Pvt Ltd · +911234567890\n123 Test Street, Mumbai 400001\nMaharashtra',
  },
  placeOfSupply: { name: 'Maharashtra', code: '27' },
  isInterState: false,
  taxBreakdown: {
    cgst: +(summary.gstAmount / 2).toFixed(2),
    sgst: +(summary.gstAmount / 2).toFixed(2),
    igst: 0,
  },
  summary,
}).then((pdf) => {
  const outPath = path.join(__dirname, 'invoice-multipage-test.pdf');
  fs.writeFileSync(outPath, pdf);
  console.log(`Wrote ${outPath} (${pdf.length} bytes, ${summary.lines.length} items)`);
});
