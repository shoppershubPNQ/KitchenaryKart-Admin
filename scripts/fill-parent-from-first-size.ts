/** The companion to sync-parent-descriptions.
 *
 *  That script handles a parent whose own SKU is also one of its size SKUs.
 *  A parent with a SKU of its own (KKA0490-ROPB17 over KKPB-RND-17…30;
 *  KKCE0023-EFBS3 over its four colours) is never reached by it, so after a
 *  description document goes in, that parent's page keeps the old generic
 *  text while every size has the new copy. Found 29 Sep 2026: two parents.
 *
 *  This gives such a parent its FIRST size's description — what every other
 *  parent effectively carries, since their SKU is their first size's.
 *  Only parents that still lack house-format copy ("Key Features") while a
 *  size has it are touched.
 *
 *  Run after sync-parent-descriptions whenever a document has been applied.
 *  Usage: npx tsx scripts/fill-parent-from-first-size.ts [--apply]
 */
import { writeFileSync } from 'fs';
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');

(async () => {
  const parents = await prisma.product.findMany({
    where: { status: 'active', variants: { some: {} } },
    select: { id: true, sku: true, name: true, description: true, variants: { select: { skuSuffix: true, description: true }, orderBy: { id: 'asc' } } },
  });
  const plan: Array<{ id: number; sku: string; from: string | null; to: string; size: string | null }> = [];
  for (const p of parents) {
    if (p.variants.some((v) => v.skuSuffix === p.sku)) continue; // sync-parent-descriptions covers these
    if (p.description?.includes('Key Features')) continue;
    if (!p.variants.some((v) => v.description?.includes('Key Features'))) continue;
    // A size with no description of its own shows the PARENT's. Copying one
    // size's text up would put it on that sibling's page — the 25L salad
    // spinner showed "12 L Capacity" on 29 Sep. Wait until every size has copy.
    const bare = p.variants.filter((v) => !v.description?.trim());
    if (bare.length) {
      console.log(`  skip ${p.sku}: ${bare.map((v) => v.skuSuffix).join(', ')} would show another size's text`);
      continue;
    }
    const first = p.variants[0];
    if (!first.description?.includes('Key Features')) {
      console.log(`  skip ${p.sku}: first size ${first.skuSuffix} has no new copy yet`);
      continue;
    }
    plan.push({ id: p.id, sku: p.sku, from: p.description, to: first.description, size: first.skuSuffix });
    console.log(`  ${p.sku.padEnd(18)} ← ${String(first.skuSuffix).padEnd(20)} ${p.name.slice(0, 60)}`);
  }
  console.log(`${plan.length} parent page(s) on old text while their sizes have new copy`);
  if (!APPLY) { console.log('DRY RUN — re-run with --apply'); await prisma.$disconnect(); return; }
  if (plan.length) {
    writeFileSync(`backup-parent-from-first-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, JSON.stringify(plan, null, 2));
    for (const x of plan) await prisma.product.update({ where: { id: x.id }, data: { description: x.to } });
  }
  console.log(`${plan.length} written`);
  await prisma.$disconnect();
})();
