/** Owner 2026-11-21 ("बदल दो"): orders #354 KKMW3BVIQ9 (prabhat maji, invoice 0130) and #355 KKMW3FEIW0 (Sunil,
 *  invoice 0131) were paid on 5 Nov, cancelled before dispatch on 6 Nov (Green Chopper Big out of stock) and refunded
 *  in full by bank transfer — nothing was ever supplied. On 6 Nov the admin had no "cancelled invoice" route, so credit
 *  notes CN/2026-27/0002 + 0003 were issued. The owner wants them treated like 0141 instead:
 *    - CN 0002 + 0003 → CANCELLED (numbers stay used; GSTR-1 Table 13 credit notes: 0002–0004, 3 issued, 2 cancelled)
 *    - invoices 0130 + 0131 → CANCELLED invoices (orders.invoice_cancelled_at = the order's cancel time, 6 Nov)
 *  November 2026 GSTR-1 is NOT filed yet (owner files ~10 Dec), so nothing filed moves. Net tax effect: 0 — the invoice
 *  and its note netted to 0 before, and neither counts after.
 *
 *  #354 had a Delhivery AWB (5411010544950) typed, which is why lib/invoice-cancel.ts would not stamp it automatically;
 *  Delhivery shows that AWB "Cancelled 05 Nov, Not Picked" (checked 17–18 Nov), so the owner's decision stands.
 *
 *  Guards: exact ids/serials/invoice numbers; orders cancelled + refunded, never shipped/delivered, no replacement,
 *  no courier movement; notes not already cancelled; still before the end of November (UTC, the report's bound).
 *  RUN ONLY AFTER the admin deploy that reads credit_notes.cancelled_at — on the old code the cancelled notes would
 *  still be deducted while the invoices already left the sales (net understated by Rs 595 taxable).
 *  Dry run by default; --apply writes, with a backup JSON first.
 *    npx tsx scripts/cancel-cn-0002-0003-2026-11-21.ts [--apply --after-deploy] */
import fs from 'node:fs';
import { prisma } from '../lib/db';

const PLAN: Array<{ orderId: number; orderNumber: string; invoiceSerial: number; cnSerial: number; notPickedAwb: string | null }> = [
  // #354 was marked 'shipped' on 5 Nov when Delhivery AWB 5411010544950 was booked (typed by hand, no shipment row);
  // Delhivery shows it "Cancelled 05 Nov, Not Picked" (checked 17–18 Nov) — the parcel never left. Only that exact
  // AWB lets the shipped stamp through.
  { orderId: 354, orderNumber: 'KKMW3BVIQ9', invoiceSerial: 130, cnSerial: 2, notPickedAwb: '5411010544950' },
  { orderId: 355, orderNumber: 'KKMW3FEIW0', invoiceSerial: 131, cnSerial: 3, notPickedAwb: null },
];
const FY = '2026-27';
const NOV_END = new Date(Date.UTC(2026, 11, 1)); // 1 Dec 2026 00:00 UTC — lib/invoice-cancel.ts invoiceMonthEnd
const REASON = 'Order cancelled before dispatch and refunded in full; invoice reported as a cancelled invoice instead (owner decision 21 Nov 2026).';

(async () => {
  const now = new Date();
  if (now >= NOV_END) throw new Error('November is over — too late to move these (the month may be filed)');
  const apply = process.argv.includes('--apply');
  // Review 2026-11-21: on the OLD admin code the cancelled notes would still be deducted while the invoices already
  // left the sales — November understated by Rs 595 taxable / Rs 107.10 IGST with no warning. So --apply also needs
  // --after-deploy, passed only once the admin deploy that reads credit_notes.cancelled_at is confirmed live.
  if (apply && !process.argv.includes('--after-deploy')) {
    throw new Error('--apply needs --after-deploy: run only after the admin deploy that reads credit_notes.cancelled_at is LIVE');
  }
  const before: any[] = [];
  for (const p of PLAN) {
    const o: any = await prisma.order.findUnique({
      where: { id: p.orderId },
      select: {
        id: true, orderNumber: true, orderStatus: true, paymentStatus: true, invoiceSerial: true, invoiceFinancialYear: true,
        createdAt: true, cancelledAt: true, invoiceCancelledAt: true, shippedAt: true, deliveredAt: true, trackingNumber: true,
        replacements: { select: { id: true } },
        shipments: { select: { id: true, status: true, awb: true, cancelledAt: true, events: { select: { mappedStatus: true } } } } as any,
        creditNotes: true,
      } as any,
    });
    if (!o) throw new Error(`order ${p.orderId} missing`);
    const cn = o.creditNotes.find((c: any) => c.financialYear === FY && c.serial === p.cnSerial);
    const facts = {
      order: o.orderNumber, status: o.orderStatus, pay: o.paymentStatus, inv: `${o.invoiceFinancialYear}/${o.invoiceSerial}`,
      created: o.createdAt, cancelledAt: o.cancelledAt, invoiceCancelledAt: o.invoiceCancelledAt, shipped: o.shippedAt, delivered: o.deliveredAt,
      awb: o.trackingNumber, replacements: o.replacements.length,
      shipments: o.shipments.map((s: any) => ({ id: s.id, status: s.status, awb: s.awb, cancelledAt: s.cancelledAt, events: s.events.map((e: any) => e.mappedStatus) })),
      creditNotes: o.creditNotes.map((c: any) => ({ id: c.id, no: `${c.financialYear}/${c.serial}`, issued: c.issuedAt, total: Number(c.totalAmount), cancelledAt: c.cancelledAt })),
    };
    console.log(JSON.stringify(facts));
    const bad: string[] = [];
    if (o.orderNumber !== p.orderNumber) bad.push('order number');
    if (o.invoiceFinancialYear !== FY || o.invoiceSerial !== p.invoiceSerial) bad.push('invoice serial');
    if (o.orderStatus !== 'cancelled') bad.push('not cancelled');
    if (o.paymentStatus !== 'refunded') bad.push('not refunded');
    if (o.deliveredAt) bad.push('delivered stamp');
    if (o.shippedAt && !(p.notPickedAwb && o.trackingNumber === p.notPickedAwb)) bad.push('shipped stamp');
    if (o.trackingNumber && o.trackingNumber !== p.notPickedAwb) bad.push(`unexpected AWB ${o.trackingNumber}`);
    if (o.replacements.length) bad.push('has replacement');
    if (o.shipments.some((s: any) => s.events.some((e: any) => ['in_transit', 'out_for_delivery', 'delivered', 'rto'].includes(e.mappedStatus)))) bad.push('courier moved');
    // Same as lib/invoice-cancel.ts: any courier booking that is not closed (draft / failed / cancelled) blocks it.
    if (o.shipments.some((s: any) => !['draft', 'failed', 'cancelled'].includes(s.status))) bad.push('open courier booking');
    if (!o.cancelledAt) bad.push('no cancelledAt');
    if (o.cancelledAt && o.cancelledAt >= NOV_END) bad.push('cancelled after November');
    if (o.createdAt < new Date(Date.UTC(2026, 10, 1)) || o.createdAt >= NOV_END) bad.push('invoice not in November');
    if (o.invoiceCancelledAt) bad.push('already a cancelled invoice');
    if (!cn) bad.push(`CN ${p.cnSerial} not on this order`);
    else if (cn.cancelledAt) bad.push('CN already cancelled');
    if (o.creditNotes.filter((c: any) => !c.cancelledAt).length !== 1) bad.push('expected exactly one active CN');
    if (bad.length) throw new Error(`#${p.orderId}: ${bad.join(', ')}`);
    before.push({ order: { id: o.id, invoiceCancelledAt: o.invoiceCancelledAt, cancelledAt: o.cancelledAt }, creditNote: cn });
  }
  console.log(`\nPLAN: cancel CN ${PLAN.map((p) => String(p.cnSerial).padStart(4, '0')).join(' + ')} (cancelled_at = now, reason) and stamp invoice_cancelled_at = cancelled_at on orders ${PLAN.map((p) => p.orderId).join(' + ')}`);
  if (!apply) { console.log('dry run — pass --apply'); return; }

  const bk = `backup-cancel-cn-0002-0003-2026-11-21-${Date.now()}.json`;
  fs.writeFileSync(bk, JSON.stringify(before, null, 1));
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < PLAN.length; i++) {
      const p = PLAN[i];
      const b = before[i];
      const c = await tx.creditNote.updateMany({ where: { id: b.creditNote.id, cancelledAt: null }, data: { cancelledAt: now, cancelReason: REASON } as any });
      const o = await tx.order.updateMany({ where: { id: p.orderId, invoiceCancelledAt: null }, data: { invoiceCancelledAt: b.order.cancelledAt } });
      if (c.count !== 1 || o.count !== 1) throw new Error(`#${p.orderId}: expected 1+1 rows, got CN ${c.count} order ${o.count} — rolled back`);
    }
  });
  const after = await prisma.order.findMany({ where: { id: { in: PLAN.map((p) => p.orderId) } }, select: { id: true, invoiceCancelledAt: true, creditNotes: { select: { serial: true, cancelledAt: true, cancelReason: true } as any } } as any });
  console.log('4 written', JSON.stringify(after), 'backup', bk);
})().finally(() => prisma.$disconnect());
