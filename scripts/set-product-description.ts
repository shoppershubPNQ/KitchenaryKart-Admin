/** Put an owner-supplied description on a PRODUCT that has no sizes.
 *  (For a size/variant SKU use set-variant-description.ts — size-specific
 *  text must never go on a parent.) Refuses variant SKUs and products that
 *  have variants. Prints the product's stored specs next to the text so a
 *  mismatch (dimensions, weight, power) is caught before saving.
 *  Backs up first; dry run unless --apply; refreshes the live cache.
 *  Usage: npx tsx --env-file=.env scripts/set-product-description.ts <SKU> <text-file> [--apply] */
import * as fs from 'fs';
import { prisma } from '../lib/db';

const [SKU, FILE] = process.argv.slice(2);
const APPLY = process.argv.includes('--apply');

(async () => {
  if (!SKU || !FILE) { console.log('usage: <SKU> <text-file> [--apply]'); return; }
  const text = fs.readFileSync(FILE, 'utf8').replace(/\s+/g, ' ').trim();
  if (await prisma.productVariant.findFirst({ where: { skuSuffix: SKU }, select: { id: true } })) {
    console.log(`STOP: ${SKU} is a variant (size) SKU — use set-variant-description.ts. Nothing changed.`);
    return;
  }
  const p = await prisma.product.findUnique({
    where: { sku: SKU },
    select: { id: true, sku: true, name: true, status: true, description: true, power: true, capacity: true, dimensions: true, weight: true, material: true, _count: { select: { variants: true } } },
  });
  if (!p) { console.log(`STOP: ${SKU} not found`); return; }
  if (p._count.variants > 0) {
    console.log(`STOP: ${SKU} has ${p._count.variants} sizes — put size text on each variant instead. Nothing changed.`);
    return;
  }
  console.log(`product id=${p.id} ${p.sku} [${p.status}] "${p.name}"`);
  console.log(`stored specs: power=${p.power} | capacity=${p.capacity} | dimensions=${p.dimensions} | weight=${p.weight} | material=${p.material}`);
  console.log(`current: ${(p.description ?? '(none)').slice(0, 100)}…`);
  console.log(`new: ${text.length} chars${APPLY ? '' : '  [DRY RUN]'}`);
  if (!APPLY) { await prisma.$disconnect(); return; }
  const backup = `backup-product-description-${SKU.replace(/[^A-Za-z0-9-]/g, '_')}-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(backup, JSON.stringify(p, null, 2));
  await prisma.product.update({ where: { id: p.id }, data: { description: text } });
  const after = await prisma.product.findUnique({ where: { id: p.id }, select: { description: true } });
  console.log(`saved: ${after?.description === text ? 'YES, exact text' : 'MISMATCH'} (backup ${backup})`);
  const res = await fetch('https://kitchenarykart.com/api/revalidate?tag=products', { method: 'POST' }).catch(() => null);
  console.log(`live product cache refresh: ${res ? res.status : 'failed'}`);
  await prisma.$disconnect();
})();
