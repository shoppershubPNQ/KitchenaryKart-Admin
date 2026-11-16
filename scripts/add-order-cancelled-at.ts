/** One-off, idempotent (owner 2026-11-16: an order cancelled BEFORE DISPATCH must leave the GST report's sales and be
 *  listed as a cancelled invoice instead — "yeh directly cancel hai").
 *    orders.cancelled_at         → when the order was cancelled (general timeline). Stamped by applyOrderStatus from now on.
 *    orders.invoice_cancelled_at → the cancelled-invoice decision, stamped once at cancel time (lib/invoice-cancel.ts).
 *  Additive only: nullable, so code that predates it keeps working. Must run BEFORE the admin deploy that reads it
 *  (Prisma selects every scalar column by default).
 *  Backfill: only the three INVOICED cancelled orders, with the cancel time = their last update (the PATCH that
 *  cancelled them; nothing else was written to them after): #354 + #355 (6 Nov, both have credit notes) and #375 (16 Nov).
 *    npx tsx scripts/add-order-cancelled-at.ts */
import { prisma } from '../lib/db';

(async () => {
  const type = await prisma.$queryRawUnsafe<Array<{ data_type: string; datetime_precision: number }>>(
    "SELECT data_type, datetime_precision FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'shipped_at'",
  );
  console.log('shipped_at is', type);
  await prisma.$executeRawUnsafe('ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP(3)');
  const n = await prisma.$executeRawUnsafe(
    "UPDATE orders SET cancelled_at = updated_at WHERE id IN (354, 355, 375) AND order_status = 'cancelled' AND cancelled_at IS NULL",
  );
  console.log(`backfilled cancelled_at: ${n} row(s)`);
  // Second column (same day, after review): the cancelled-invoice decision, frozen at cancel time
  // (lib/invoice-cancel.ts). Only #375 KKMWI4BSPD qualifies: paid, invoice 0141, cancelled 16 Nov in its invoice's
  // month, never dispatched, no credit note. #354 (AWB typed) and #355 (credit note 0003) stay sales.
  await prisma.$executeRawUnsafe('ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_cancelled_at TIMESTAMP(3)');
  const m = await prisma.$executeRawUnsafe(
    "UPDATE orders SET invoice_cancelled_at = cancelled_at WHERE id = 375 AND order_status = 'cancelled' AND invoice_cancelled_at IS NULL AND cancelled_at IS NOT NULL",
  );
  console.log(`backfilled invoice_cancelled_at: ${m} row(s)`);
  const rows = await prisma.$queryRawUnsafe(
    "SELECT id, order_number, order_status, payment_status, invoice_serial, cancelled_at, invoice_cancelled_at, created_at FROM orders WHERE cancelled_at IS NOT NULL OR invoice_cancelled_at IS NOT NULL ORDER BY id",
  );
  console.log(rows);
  const cols = await prisma.$queryRawUnsafe(
    "SELECT column_name, data_type, datetime_precision, is_nullable FROM information_schema.columns WHERE table_name = 'orders' AND column_name IN ('cancelled_at', 'invoice_cancelled_at')",
  );
  console.log(cols);
  await prisma.$disconnect();
})();
