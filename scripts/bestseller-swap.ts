/** Swap one product in the home "Best Seller" collection for another, in the
 *  SAME position (the collection's SKU list drives the home section and
 *  overrides the isBestseller flag — see memory "New Arrivals = COLLECTION").
 *  Refuses a replacement that is not active / not in stock, backs up the
 *  collection, then refreshes the storefront home cache.
 *  Usage: npx tsx --env-file=.env scripts/bestseller-swap.ts <OLD_SKU> <NEW_SKU> [--apply] */
import * as fs from 'fs';
import { prisma } from '../lib/db';

const [OLD, NEW] = process.argv.slice(2);
const APPLY = process.argv.includes('--apply');

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    try { const j = JSON.parse(v); if (Array.isArray(j)) return j.map(String); } catch { /* not JSON */ }
    return v.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

(async () => {
  if (!OLD || !NEW) { console.log('usage: <OLD_SKU> <NEW_SKU> [--apply]'); return; }
  const col = await prisma.collection.findFirst({ where: { slug: 'bestsellers' } });
  if (!col) { console.log('STOP: bestsellers collection not found'); return; }
  const skus = list(col.productSkus);
  const at = skus.indexOf(OLD);
  if (at < 0) { console.log(`STOP: ${OLD} is not in Best Seller`); return; }
  if (skus.includes(NEW)) { console.log(`STOP: ${NEW} is already in Best Seller`); return; }

  const p = await prisma.product.findUnique({ where: { sku: NEW }, select: { name: true, status: true, stock: true, variants: { select: { stock: true } } } });
  if (!p || p.status !== 'active') { console.log(`STOP: ${NEW} is not an active product`); return; }
  const stock = p.variants.length ? p.variants.reduce((t, v) => t + v.stock, 0) : p.stock;
  if (stock <= 0) { console.log(`STOP: ${NEW} is out of stock`); return; }

  const next = [...skus];
  next[at] = NEW;
  console.log(`position ${at + 1}: ${OLD} -> ${NEW} "${p.name}" (stock ${stock})${APPLY ? '' : '  [DRY RUN]'}`);
  if (!APPLY) { await prisma.$disconnect(); return; }
  fs.writeFileSync(`backup-collection-bestsellers-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(col, null, 2));
  // Keep the column's existing shape (JSON array vs text).
  const value = Array.isArray(col.productSkus) ? next : JSON.stringify(next);
  await prisma.collection.update({ where: { id: col.id }, data: { productSkus: value as never } });
  console.log('saved:', JSON.stringify(next));
  for (const tag of ['collections', 'products']) {
    const res = await fetch(`https://kitchenarykart.com/api/revalidate?tag=${tag}`, { method: 'POST' }).catch(() => null);
    console.log(`cache ${tag}: ${res ? res.status : 'failed'}`);
  }
  await prisma.$disconnect();
})();
