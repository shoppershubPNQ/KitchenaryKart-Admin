/** One-off, idempotent: product_variants.description (nullable TEXT).
 *  Sizes of one product have different features, so each variant can carry
 *  its own description; null = show the parent's. Additive only. */
import { prisma } from '../lib/db';

(async () => {
  await prisma.$executeRawUnsafe('ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS description TEXT');
  const col = await prisma.$queryRawUnsafe(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'product_variants' AND column_name = 'description'",
  );
  console.log(col);
  await prisma.$disconnect();
})();
