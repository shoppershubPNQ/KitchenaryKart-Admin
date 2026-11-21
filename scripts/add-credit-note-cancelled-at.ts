/** One-off, idempotent (owner 2026-11-21: CN 0002/0003 should not have been credit notes — the orders were cancelled
 *  before dispatch — so a credit note must be CANCELLABLE, keeping its number for GSTR-1 Table 13).
 *    credit_notes.cancelled_at   → when the note was cancelled (NULL = active)
 *    credit_notes.cancel_reason  → why
 *  Additive only: nullable, so code that predates it keeps working. Must run BEFORE the admin deploy that reads it
 *  (Prisma selects every scalar column by default; the build's `prisma db push` would add it too, best-effort).
 *  Schema only — no data is changed here. The cancellation of 0002/0003 is scripts/cancel-cn-0002-0003-2026-11-21.ts.
 *    npx tsx scripts/add-credit-note-cancelled-at.ts */
import { prisma } from '../lib/db';

(async () => {
  const like = await prisma.$queryRawUnsafe(
    "SELECT data_type, datetime_precision FROM information_schema.columns WHERE table_name = 'credit_notes' AND column_name = 'issued_at'",
  );
  console.log('issued_at is', like);
  await prisma.$executeRawUnsafe('ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP(3)');
  await prisma.$executeRawUnsafe('ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS cancel_reason TEXT');
  const cols = await prisma.$queryRawUnsafe(
    "SELECT column_name, data_type, datetime_precision, is_nullable FROM information_schema.columns WHERE table_name = 'credit_notes' AND column_name IN ('cancelled_at', 'cancel_reason') ORDER BY column_name",
  );
  console.log(cols);
  const rows = await prisma.$queryRawUnsafe('SELECT id, financial_year, serial, cancelled_at, cancel_reason FROM credit_notes ORDER BY financial_year, serial');
  console.log(rows);
  await prisma.$disconnect();
})();
