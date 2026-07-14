/**
 * Audit-grade invoice calculator.
 *
 * Prints an order's invoice breakdown at FULL precision (unrounded) next to
 * the exact figures the live invoice uses (2-decimal), and calls out every
 * round-off explicitly — so at audit time you can reconcile paise-to-paise
 * and see precisely where (and how much) rounding happened.
 *
 * Uses the SAME functions the real invoice/checkout use (computeOrderSummary,
 * detectStateFromAddress) so this can never drift from what customers are
 * actually charged. Read-only: never allocates a serial, never writes.
 *
 * Run:  npx tsx scripts/audit-invoice-calc.ts <ORDER_NUMBER>
 * e.g.  npx tsx scripts/audit-invoice-calc.ts KKMRKBAG8I
 */
import { prisma } from '../lib/db';
import { computeOrderSummary } from '../lib/order-summary';
import { detectStateFromAddress, GST_STATES } from '../lib/gst-states';

const SELLER_STATE_CODE = '27'; // Maharashtra (matches company_state_code default)

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const f = (n: number, dp = 6) => n.toFixed(dp);
const inr = (n: number) => `₹${n.toFixed(2)}`;

async function main() {
  const orderNumber = process.argv[2];
  if (!orderNumber) {
    console.error('Usage: npx tsx scripts/audit-invoice-calc.ts <ORDER_NUMBER>');
    process.exit(1);
  }

  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: { items: { include: { product: { select: { hsnCode: true } } } }, customer: true },
  });
  if (!order) {
    console.error(`Order not found: ${orderNumber}`);
    process.exit(1);
  }

  const discount = Number(order.discountAmount || 0);
  const shipping = Number(order.shippingCost || 0);
  const items = order.items.map((it) => ({
    name: it.productName || '',
    sku: it.productSku || '',
    hsnCode: it.product?.hsnCode ?? null,
    lineInclusive: Number(it.lineTotal),
    quantity: it.quantity,
    taxPercent: Number(it.taxPercent),
  }));

  // ── Authoritative figures — the exact function the invoice/checkout use ──
  const sys = computeOrderSummary(items, discount, shipping);

  // ── Full-precision (UNROUNDED) parallel computation, same formulae ──
  const inclusiveTotal = items.reduce((s, i) => s + i.lineInclusive, 0);
  const discountPct = inclusiveTotal > 0 ? (discount / inclusiveTotal) * 100 : 0;
  const rates = [...new Set(items.map((i) => i.taxPercent))];
  const shippingRate = rates.length === 1 ? rates[0] : 18;

  let exNetPrice = 0, exNetValue = 0, exGoodsGst = 0;
  const exactLines = items.map((i) => {
    const rate = i.taxPercent;
    const netPrice = i.lineInclusive / (1 + rate / 100);
    const netValue = netPrice * (1 - discountPct / 100);
    const gst = netValue * (rate / 100);
    exNetPrice += netPrice; exNetValue += netValue; exGoodsGst += gst;
    return { ...i, netPrice, netValue, gst };
  });
  const exShipGst = shipping * (shippingRate / 100);
  const exGstTotal = exGoodsGst + exShipGst;
  const exPayable = exNetValue + shipping + exGstTotal;
  const roundedPayable = Math.round(exPayable);

  // ── Place of supply + CGST/SGST vs IGST ──
  const detected =
    detectStateFromAddress(order.shippingAddress) ??
    detectStateFromAddress(order.customer?.billingAddress) ??
    GST_STATES.find((s) => s.code === SELLER_STATE_CODE) ??
    null;
  const isInter = !!(detected && detected.code !== SELLER_STATE_CODE);

  const serial =
    order.invoiceFinancialYear && order.invoiceSerial != null
      ? `KK/${order.invoiceFinancialYear}/${String(order.invoiceSerial).padStart(4, '0')}`
      : `PRO/${order.orderNumber} (PROFORMA — no serial; order not paid)`;

  const line = '─'.repeat(78);
  console.log(line);
  console.log(`AUDIT INVOICE CALCULATION   ·   Order ${order.orderNumber}`);
  console.log(line);
  console.log(`Payment status : ${order.paymentStatus}   Invoice no: ${serial}`);
  console.log(`Buyer          : ${order.customerName ?? '—'}   GSTIN: ${order.customerGstin || order.customer?.gstNumber || '—'}`);
  console.log(`Place of supply: ${detected?.name ?? 'unknown'} (${detected?.code ?? '--'})  →  ${isInter ? 'INTER-state → IGST' : 'INTRA-state → CGST + SGST'}`);
  console.log(`Tax type       : goods ${rates.join('/')}%   shipping ${shippingRate}%   discount ${f(discountPct, 4)}%`);

  console.log('\nPER-LINE  (stored lineTotal is GST-INCLUSIVE)');
  console.log(line);
  for (let k = 0; k < exactLines.length; k++) {
    const e = exactLines[k];
    const s = sys.lines[k];
    console.log(`• ${e.sku}  x${e.quantity}  @${e.taxPercent}%  HSN ${e.hsnCode ?? '—'}`);
    console.log(`    Inclusive line total      : ${inr(e.lineInclusive)}`);
    console.log(`    Ex-GST (net price)  exact : ${f(e.netPrice)}   → invoice ${inr(s.lineNetPrice)}   round-off ${f(s.lineNetPrice - e.netPrice, 6)}`);
    console.log(`    Net value (post-disc) ex. : ${f(e.netValue)}   → invoice ${inr(s.lineNetValue)}   round-off ${f(s.lineNetValue - e.netValue, 6)}`);
    console.log(`    GST on line          exact: ${f(e.gst)}   → invoice ${inr(s.lineGst)}   round-off ${f(s.lineGst - e.gst, 6)}`);
  }

  console.log('\nTOTALS');
  console.log(line);
  const row = (label: string, exact: number, sysVal: number) =>
    console.log(`${label.padEnd(26)} exact ${f(exact).padStart(15)}   invoice ${inr(sysVal).padStart(13)}   round-off ${f(sysVal - exact, 6).padStart(10)}`);
  row('Net Price (ex-GST)', exNetPrice, sys.netPrice);
  row('Discount', exNetPrice - exNetValue, sys.discountAmount);
  row('Net Value (GST base)', exNetValue, sys.netValue);
  row('Goods GST', exGoodsGst, r2(exGoodsGst)); // shown for transparency
  row('Shipping GST', exShipGst, r2(exShipGst));
  row('TOTAL GST', exGstTotal, sys.gstAmount);
  if (isInter) {
    console.log(`   IGST                    : ${inr(sys.gstAmount)}`);
  } else {
    console.log(`   CGST (½)                : ${inr(r2(sys.gstAmount / 2))}`);
    console.log(`   SGST (½)                : ${inr(r2(sys.gstAmount / 2))}`);
  }
  console.log(`Shipping (ex-GST)          : ${inr(sys.shipping)}`);

  console.log('\nFINAL ROUND-OFF  (to a whole rupee — the invoice "Round Off" line)');
  console.log(line);
  console.log(`Exact payable   : ${f(exPayable)}`);
  console.log(`Rounded payable : ${inr(roundedPayable)}   (system netPayable ${inr(sys.netPayable)})`);
  console.log(`ROUND OFF        : ${inr(sys.roundOff)}   [+ = collected extra, − = waived paise]`);

  console.log('\nRECONCILIATION');
  console.log(line);
  const stored = Number(order.totalAmount);
  console.log(`Stored order.totalAmount (binding charge) : ${inr(stored)}`);
  console.log(`Computed Net Payable                      : ${inr(sys.netPayable)}   ${stored === sys.netPayable ? '✅ MATCH' : '⚠️ MISMATCH'}`);
  if (order.taxAmount != null) {
    const st = Number(order.taxAmount);
    console.log(`Stored order.taxAmount                    : ${inr(st)}`);
    console.log(`Computed TOTAL GST                        : ${inr(sys.gstAmount)}   ${r2(st) === r2(sys.gstAmount) ? '✅ MATCH' : '⚠️ MISMATCH'}`);
  }
  console.log(line);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
