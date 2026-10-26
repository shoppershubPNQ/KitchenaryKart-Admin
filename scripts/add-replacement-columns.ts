/** One-off, idempotent: the two columns behind free replacement orders (owner 2026-10-26 — a part arrived broken,
 *  "replacement order kaise kare").
 *    orders.replacement_of_id         → the original order (FK, ON DELETE RESTRICT — an original that has
 *                                       replacements cannot be deleted, so the link can never be lost) + index
 *    order_items.declared_unit_value  → value per unit declared to the courier / printed on the Delivery Challan
 *  Additive only: both nullable, so code that predates them keeps working. Must run BEFORE the admin deploy that
 *  reads them (Prisma selects every scalar column by default). */
import { prisma } from '../lib/db';

(async () => {
  await prisma.$executeRawUnsafe('ALTER TABLE orders ADD COLUMN IF NOT EXISTS replacement_of_id INTEGER');
  await prisma.$executeRawUnsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_replacement_of_id_fkey') THEN
      ALTER TABLE orders ADD CONSTRAINT orders_replacement_of_id_fkey
        FOREIGN KEY (replacement_of_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
  END $$`);
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS orders_replacement_of_id_idx ON orders(replacement_of_id)');
  await prisma.$executeRawUnsafe('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS declared_unit_value DECIMAL(10,2)');
  const cols = await prisma.$queryRawUnsafe(
    "SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE (table_name = 'orders' AND column_name = 'replacement_of_id') OR (table_name = 'order_items' AND column_name = 'declared_unit_value')",
  );
  console.log(cols);
  await prisma.$disconnect();
})();
