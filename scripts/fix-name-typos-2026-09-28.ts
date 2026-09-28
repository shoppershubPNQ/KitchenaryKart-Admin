/** Name and size-label typos left open in Part 21, approved by the owner 28 Sep 2026.
 *
 *  Each change names the exact row and the value it expects to find. If the
 *  row no longer holds that value — someone edited it, or a partner import
 *  came through — it is refused rather than overwritten.
 *
 *  The partner feed carries the same "Tripple" and "Drainr" spellings, so an
 *  import with Details ticked would bring them back.
 *
 *  Scanned first: none of these typos appears in a description, meta title or
 *  meta description — only in the names and size labels below.
 *
 *  Usage: npx tsx scripts/fix-name-typos-2026-09-28.ts [--apply]
 */
import { writeFileSync } from 'fs';
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');

type Fix =
  | { table: 'product'; id: number; sku: string; field: 'name'; from: string; to: string }
  | { table: 'variant'; id: number; sku: string; field: 'variantValue'; from: string; to: string };

const FIXES: Fix[] = [
  { table: 'product', id: 2373, sku: 'KKBT0046-CD43', field: 'name',
    from: 'SS Cereal Dispenser - Tripple 4L + 4L + 4L', to: 'SS Cereal Dispenser - Triple 4L + 4L + 4L' },
  { table: 'product', id: 3051, sku: 'KKSP0041-SCRL5', field: 'name',
    from: 'Spare for Plastic Black Cereal Dispenser 3.5L - Plastic Drainr Plate',
    to: 'Spare for Plastic Black Cereal Dispenser 3.5L - Plastic Drainer Plate' },
  { table: 'product', id: 3371, sku: 'KK-3924-001', field: 'name',
    from: 'Wooden Bamboo Bathroom Accessory Set -  2pp', to: 'Wooden Bamboo Bathroom Accessory Set - 2pp' },
  { table: 'product', id: 3372, sku: 'KK-3924-002', field: 'name',
    from: 'Wooden Bamboo Bathroom Accessory Set -  4pp', to: 'Wooden Bamboo Bathroom Accessory Set - 4pp' },
  // The listing holds No. 1 – No. 8; each size page appends its own number,
  // so the parent name carrying "No. 1" made the No. 2 page read
  // "Plastic Serving Plate No. 1 — No. 2".
  { table: 'product', id: 2483, sku: 'KKBT0334-SP1', field: 'name',
    from: 'Plastic Serving Plate No. 1', to: 'Plastic Serving Plate' },
  { table: 'variant', id: 1057, sku: 'KKBT0215-ACRA7', field: 'variantValue',
    from: 'A7 (5062', to: 'A7 (5062)' },
  { table: 'variant', id: 1059, sku: 'KKBT0217-ACRA8H', field: 'variantValue',
    from: 'A8-Horizonta(5051)l', to: 'A8-Horizontal(5051)' },
];

async function current(f: Fix): Promise<string | null | undefined> {
  if (f.table === 'product') {
    const r = await prisma.product.findUnique({ where: { id: f.id }, select: { sku: true, name: true } });
    return r?.sku === f.sku ? r.name : undefined;
  }
  const r = await prisma.productVariant.findUnique({ where: { id: f.id }, select: { skuSuffix: true, variantValue: true } });
  return r?.skuSuffix === f.sku ? r.variantValue : undefined;
}

(async () => {
  const ready: Fix[] = [];
  const refused: string[] = [];
  for (const f of FIXES) {
    const now = await current(f);
    if (now === undefined) refused.push(`${f.sku}: row #${f.id} not found under this SKU`);
    else if (now === f.to) console.log(`already done  ${f.sku.padEnd(17)} ${f.to}`);
    else if (now !== f.from) refused.push(`${f.sku}: expected ${JSON.stringify(f.from)}, found ${JSON.stringify(now)}`);
    else { ready.push(f); console.log(`${f.sku.padEnd(17)} ${f.field.padEnd(12)} ${JSON.stringify(f.from)} → ${JSON.stringify(f.to)}`); }
  }
  if (refused.length) {
    console.log(`\nREFUSED — nothing written:\n  ${refused.join('\n  ')}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  if (!APPLY) {
    console.log(`\n${ready.length} change(s). DRY RUN — re-run with --apply`);
    await prisma.$disconnect();
    return;
  }

  const file = `backup-name-typos-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  writeFileSync(file, JSON.stringify(ready, null, 2));
  for (const f of ready) {
    if (f.table === 'product') await prisma.product.update({ where: { id: f.id }, data: { name: f.to } });
    else await prisma.productVariant.update({ where: { id: f.id }, data: { variantValue: f.to } });
  }
  let ok = 0;
  for (const f of ready) if ((await current(f)) === f.to) ok++;
  console.log(`\nbackup: ${file} · verified ${ok}/${ready.length}`);
  await prisma.$disconnect();
})();
