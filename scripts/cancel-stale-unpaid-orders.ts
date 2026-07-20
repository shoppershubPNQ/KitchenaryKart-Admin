/**
 * One-time cleanup of stale UNPAID orders (owner-approved 2026-07-18).
 *
 * SAFETY: never cancels blindly. For every order still `paymentStatus=pending`
 * with a razorpayOrderId we ask Razorpay whether a payment was actually
 * `captured` (the webhook has been unreliable — a real payment can sit as
 * "pending" in our DB). Only orders Razorpay confirms are NOT paid, and that
 * are older than MIN_AGE_HOURS, get cancelled.
 *
 * Stock is untouched: stock is only decremented on the "delivered" transition,
 * so a pending order never reserved any.
 *
 *   npx tsx scripts/cancel-stale-unpaid-orders.ts             # dry run (no writes, no emails)
 *   npx tsx scripts/cancel-stale-unpaid-orders.ts --cancel    # cancel confirmed-unpaid orders
 *   npx tsx scripts/cancel-stale-unpaid-orders.ts --finalize-paid  # also mark any truly-paid ones as paid (SENDS EMAILS)
 */
import { prisma } from '../lib/db';
import { fetchRazorpayOrderPayments } from '../lib/integrations/razorpay';
import { finalizePaidOrder } from '../lib/order-payment';
import * as fs from 'fs';
import * as path from 'path';

const DO_CANCEL = process.argv.includes('--cancel');
const DO_FINALIZE = process.argv.includes('--finalize-paid');
const MIN_AGE_HOURS = 24;

async function main() {
  const now = Date.now();
  const pending = await prisma.order.findMany({
    where: { paymentStatus: 'pending', orderStatus: { not: 'cancelled' }, razorpayOrderId: { not: null } },
    select: { id: true, orderNumber: true, razorpayOrderId: true, createdAt: true, totalAmount: true,
      customer: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`${DO_CANCEL || DO_FINALIZE ? 'APPLYING' : 'DRY RUN'} — checking ${pending.length} pending orders against Razorpay\n`);

  const paid: any[] = [];
  const unpaidOld: any[] = [];
  const unpaidYoung: any[] = [];
  const errors: any[] = [];

  for (const o of pending) {
    const ageH = (now - new Date(o.createdAt).getTime()) / 3600000;
    try {
      const payments = await fetchRazorpayOrderPayments(o.razorpayOrderId!);
      const captured = payments.find((p) => p.status === 'captured');
      const statuses = payments.map((p) => p.status).join(',') || '(none)';
      if (captured) {
        paid.push({ ...o, ageH, captured });
        console.log(`  💰 PAID   ${o.orderNumber}  ${ageH.toFixed(0)}h  ₹${o.totalAmount}  rzpPayment=${captured.id}  [${statuses}]`);
      } else if (ageH >= MIN_AGE_HOURS) {
        unpaidOld.push({ ...o, ageH });
        console.log(`  ✖ unpaid ${o.orderNumber}  ${ageH.toFixed(0)}h  ₹${o.totalAmount}  [${statuses}] -> cancel`);
      } else {
        unpaidYoung.push({ ...o, ageH });
        console.log(`  · young  ${o.orderNumber}  ${ageH.toFixed(0)}h  ₹${o.totalAmount}  [${statuses}] -> keep (under ${MIN_AGE_HOURS}h)`);
      }
    } catch (e: any) {
      errors.push({ orderNumber: o.orderNumber, error: e?.message || 'failed' });
      console.log(`  ! error  ${o.orderNumber}: ${e?.message || 'failed'}`);
    }
  }

  console.log(`\nSummary: actually PAID ${paid.length} | confirmed unpaid & >${MIN_AGE_HOURS}h ${unpaidOld.length} | too young ${unpaidYoung.length} | errors ${errors.length}`);

  if (paid.length) {
    console.log(`\n⚠️  ${paid.length} order(s) were ACTUALLY PAID on Razorpay but sit as pending in our DB.`);
    console.log('   These are NOT cancelled. Run with --finalize-paid to mark them paid (this SENDS confirmation emails).');
  }

  if (!DO_CANCEL && !DO_FINALIZE) { console.log('\n(dry run — no writes. Pass --cancel and/or --finalize-paid)'); return; }

  const stamp = new Date().toISOString().slice(0, 10);
  if (DO_FINALIZE && paid.length) {
    for (const p of paid) {
      await finalizePaidOrder(p.id, { razorpayPaymentId: p.captured.id, amountPaise: p.captured.amount ?? null, source: 'reconcile' });
      console.log(`  finalized paid: ${p.orderNumber}`);
    }
  }
  if (DO_CANCEL && unpaidOld.length) {
    const bp = path.resolve(__dirname, '..', `backup-cancelled-orders-${stamp}.json`);
    fs.writeFileSync(bp, JSON.stringify(unpaidOld.map((o) => ({ id: o.id, orderNumber: o.orderNumber, totalAmount: String(o.totalAmount), createdAt: o.createdAt })), null, 2), 'utf8');
    console.log(`\nbackup: ${path.basename(bp)}`);
    for (const o of unpaidOld) {
      await prisma.order.update({ where: { id: o.id }, data: { orderStatus: 'cancelled' } });
      console.log(`  cancelled: ${o.orderNumber}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
