/** One-off, idempotent: add orders.abandoned_alert_at (nullable) for the
 *  abandoned-checkout alert cron. Additive only — no existing data changes.
 *  Raw SQL rather than `prisma db push` (same as the other 2026 columns). */
import { prisma } from '../lib/db';

(async () => {
  await prisma.$executeRawUnsafe('ALTER TABLE orders ADD COLUMN IF NOT EXISTS abandoned_alert_at TIMESTAMP(3)');
  const col = await prisma.$queryRawUnsafe(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'abandoned_alert_at'",
  );
  console.log(col);
  await prisma.$disconnect();
})();
