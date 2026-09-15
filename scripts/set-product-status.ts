/** Take a product off sale (draft / discontinued) or back on (active) without
 *  deleting anything. A draft's page 404s and it drops out of listings,
 *  search, sitemap and feeds; checkout refuses it. Reversible.
 *  Backs up the row; dry run unless --apply; refreshes the live cache.
 *  Usage: npx tsx --env-file=.env scripts/set-product-status.ts <SKU> <active|draft|discontinued> [--apply] */
import * as fs from 'fs';
import { prisma } from '../lib/db';

const [SKU, STATUS] = process.argv.slice(2);
const APPLY = process.argv.includes('--apply');
const ALLOWED = ['active', 'draft', 'discontinued'] as const;

(async () => {
  if (!SKU || !ALLOWED.includes(STATUS as (typeof ALLOWED)[number])) {
    console.log('usage: <SKU> <active|draft|discontinued> [--apply]');
    return;
  }
  const p = await prisma.product.findUnique({ where: { sku: SKU }, select: { id: true, sku: true, name: true, status: true, stock: true } });
  if (!p) { console.log(`STOP: ${SKU} not found`); return; }
  console.log(`${p.sku} "${p.name}" status ${p.status} -> ${STATUS}${APPLY ? '' : '  [DRY RUN]'}`);
  if (!APPLY || p.status === STATUS) { if (p.status === STATUS) console.log('already that status'); await prisma.$disconnect(); return; }
  const backup = `backup-product-status-${SKU.replace(/[^A-Za-z0-9-]/g, '_')}-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(backup, JSON.stringify(p, null, 2));
  await prisma.product.update({ where: { id: p.id }, data: { status: STATUS as never } });
  console.log(`saved (backup ${backup})`);
  for (const tag of ['products', 'category-tree', 'category-counts']) {
    const res = await fetch(`https://kitchenarykart.com/api/revalidate?tag=${tag}`, { method: 'POST' }).catch(() => null);
    console.log(`cache ${tag}: ${res ? res.status : 'failed'}`);
  }
  await prisma.$disconnect();
})();
