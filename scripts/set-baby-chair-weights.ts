/** Baby chair weights (owner, 28 Sep 2026): "5 kg 300 g — one chair".
 *
 *  Both sizes inherited 5kg 300g from the parent row, which is named for the
 *  carton "(1 Carton: 2 Pc)" — so one of them was wrong whichever it meant.
 *  With the owner's answer:
 *    Loose (1 chair)       → 5kg 300g
 *    Carton (2 chairs)     → 10kg 600g  (2 × 5kg 300g; chairs only, packaging
 *                                        not included — revise if the owner
 *                                        has a weighed carton figure)
 *  The parent row's own SKU is the carton's, so it takes the carton weight too.
 *
 *  Usage: npx tsx scripts/set-baby-chair-weights.ts [--apply]
 */
import { writeFileSync } from 'fs';
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');

const PLAN = [
  { table: 'variant' as const, id: 1285, sku: 'KKHRE0002-FBCL', from: null, to: '5kg 300g' },
  { table: 'variant' as const, id: 1284, sku: 'KKHRE0001-FBC', from: null, to: '10kg 600g' },
  { table: 'product' as const, id: 2769, sku: 'KKHRE0001-FBC', from: '5kg 300g', to: '10kg 600g' },
];

async function read(p: (typeof PLAN)[number]) {
  if (p.table === 'product') {
    const r = await prisma.product.findUnique({ where: { id: p.id }, select: { sku: true, weight: true } });
    return r?.sku === p.sku ? { ok: true, weight: r.weight } : { ok: false, weight: null };
  }
  const r = await prisma.productVariant.findUnique({ where: { id: p.id }, select: { skuSuffix: true, weight: true } });
  return r?.skuSuffix === p.sku ? { ok: true, weight: r.weight } : { ok: false, weight: null };
}

(async () => {
  for (const p of PLAN) {
    const now = await read(p);
    if (!now.ok) throw new Error(`${p.table} #${p.id} is not ${p.sku}`);
    if (now.weight !== p.from && now.weight !== p.to) throw new Error(`${p.sku} ${p.table}: expected ${p.from}, found ${now.weight}`);
    console.log(`${p.sku.padEnd(16)} ${p.table.padEnd(8)} ${String(now.weight).padEnd(10)} → ${p.to}`);
  }
  if (!APPLY) { console.log('DRY RUN — re-run with --apply'); await prisma.$disconnect(); return; }

  writeFileSync(`backup-baby-chair-weights-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(PLAN, null, 2));
  for (const p of PLAN) {
    if (p.table === 'product') await prisma.product.update({ where: { id: p.id }, data: { weight: p.to } });
    else await prisma.productVariant.update({ where: { id: p.id }, data: { weight: p.to } });
  }
  let ok = 0;
  for (const p of PLAN) if ((await read(p)).weight === p.to) ok++;
  console.log(`verified ${ok}/${PLAN.length}`);
  await prisma.$disconnect();
})();
