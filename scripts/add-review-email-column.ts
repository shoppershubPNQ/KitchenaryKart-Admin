/** One-off, idempotent: orders.review_email_at (nullable) — marks that the
 *  post-delivery "how was it?" review request has been sent for this order,
 *  so the cron never emails the same buyer twice. Additive only. */
import { prisma } from '../lib/db';

(async () => {
  await prisma.$executeRawUnsafe('ALTER TABLE orders ADD COLUMN IF NOT EXISTS review_email_at TIMESTAMP(3)');
  const col = await prisma.$queryRawUnsafe(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'review_email_at'",
  );
  console.log(col);
  await prisma.$disconnect();
})();
