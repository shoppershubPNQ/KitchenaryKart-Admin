/** When a product's own SKU is also one of its variant SKUs, the description
 *  scripts write to the VARIANT row and the product row keeps its old text —
 *  which still reaches feeds, search and the page payload. This brings any
 *  such parent back in step with its own variant.
 *
 *  Lookups are batched and the writes go in one transaction: the per-row
 *  version was cut off part-way through a 117-SKU run on 29 Sep 2026. The
 *  backup name carries the time — a date-only name was overwritten by every
 *  later run the same day. */
import { writeFileSync } from 'fs';
import { prisma } from '../lib/db';
const APPLY = process.argv.includes('--apply');
(async () => {
  const dupes = await prisma.$queryRawUnsafe<Array<{ sku: string }>>(
    `select p.sku from products p join product_variants v on v.sku_suffix = p.sku
       where v.description is not null and (p.description is null or p.description <> v.description)`);
  console.log(`${dupes.length} parent row(s) out of step with their own variant`);
  const skus = dupes.map((d) => d.sku);
  const parents = await prisma.product.findMany({
    where: { sku: { in: skus } },
    select: { id: true, sku: true, description: true, variants: { select: { skuSuffix: true, description: true } } },
  });
  const plan: Array<{ sku: string; id: number; old: string | null; text: string }> = [];
  for (const p of parents) {
    const v = p.variants.find((x) => x.skuSuffix === p.sku);
    if (!v?.description) continue;
    // A sibling with no description of its own shows the parent's, so syncing
    // would put this size's text on that sibling's page (29 Sep: the 25L salad
    // spinner showed the 12L copy). Wait until every size has its own.
    const bare = p.variants.filter((x) => !x.description?.trim());
    if (bare.length) {
      console.log(`  skip ${p.sku}: ${bare.map((x) => x.skuSuffix).join(', ')} would show this size's text`);
      continue;
    }
    console.log(`  ${p.sku.padEnd(20)} ${String(p.description?.length ?? 0).padStart(5)} → ${String(v.description.length).padStart(5)} ch`);
    plan.push({ sku: p.sku, id: p.id, old: p.description, text: v.description });
  }
  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply'); await prisma.$disconnect(); return; }
  if (plan.length) {
    writeFileSync(`backup-parent-desc-sync-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, JSON.stringify(plan, null, 2));
    await prisma.$transaction(plan.map((x) => prisma.product.update({ where: { id: x.id }, data: { description: x.text } })));
  }
  console.log(`\n${plan.length} written`);
  await prisma.$disconnect();
})();
