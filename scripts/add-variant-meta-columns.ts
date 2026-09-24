/** Add meta_title / meta_description to product_variants.
 *
 *  Additive and idempotent, the same shape as the 2026-09-15 script that added
 *  the per-variant description column. The build-time db-sync would apply this
 *  on the next deploy anyway; running it now lets the titles be written and
 *  checked before anything ships.
 *
 *  Usage: npx tsx scripts/add-variant-meta-columns.ts [--apply]
 */
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');

const STATEMENTS = [
  `alter table product_variants add column if not exists meta_title text`,
  `alter table product_variants add column if not exists meta_description text`,
];

(async () => {
  const before = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    `select column_name from information_schema.columns
       where table_name = 'product_variants' and column_name in ('meta_title','meta_description')`
  );
  console.log(`present before: ${before.map((c) => c.column_name).join(', ') || 'neither'}`);

  if (!APPLY) {
    console.log(`\nwould run:\n  ${STATEMENTS.join('\n  ')}\n\nDRY RUN — re-run with --apply`);
    await prisma.$disconnect();
    return;
  }

  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql);
    console.log(`ok: ${sql}`);
  }
  const after = await prisma.$queryRawUnsafe<Array<{ column_name: string; data_type: string }>>(
    `select column_name, data_type from information_schema.columns
       where table_name = 'product_variants' and column_name in ('meta_title','meta_description')`
  );
  console.log(`\npresent after: ${after.map((c) => `${c.column_name} (${c.data_type})`).join(', ')}`);
  await prisma.$disconnect();
})();
