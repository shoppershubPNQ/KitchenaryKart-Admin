/** Fill EMPTY per-variant spec columns (capacity / power / dimensions) from
 *  the variant's own axis values, so a size never shows its parent's specs.
 *
 *  Why: e.g. the planetary mixer's 10L/20L/30L sizes store their size only in
 *  the variant value {"Capacity":"Bowl Capacity: 10L | …","Power":"800W"};
 *  their capacity/power columns were empty, so cards and the PDP spec table
 *  fell back to the parent's 7L / 600W. Owner: "product ki details mismatch
 *  nahi honi chahiye" (2026-09-15).
 *
 *  Only fills columns that are EMPTY, only from the variant's own value, and
 *  only for axis names that clearly mean that spec. Never overwrites.
 *  Dry run unless --apply (backs up every touched row first). */
import * as fs from 'fs';
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');
type Col = 'capacity' | 'power' | 'dimensions';
const AXIS_TO_COL: Array<[RegExp, Col]> = [
  [/^(capacity|bowl capacity|volume|litre|liter)s?$/i, 'capacity'],
  [/^(power|wattage|watt|motor power)s?$/i, 'power'],
  [/^(dimensions?|size \(dimensions\))$/i, 'dimensions'],
];

function axes(type: string | null, value: string | null): Array<[string, string]> {
  if (!value) return [];
  const v = value.trim();
  if (v.startsWith('{')) {
    try {
      const o = JSON.parse(v);
      if (o && typeof o === 'object') return Object.entries(o).map(([k, x]) => [k.trim(), String(x).trim()]);
    } catch {
      /* not JSON */
    }
  }
  return type ? [[type.trim(), v]] : [];
}

(async () => {
  const variants = await prisma.productVariant.findMany({
    where: { product: { status: 'active' } },
    select: { id: true, skuSuffix: true, variantType: true, variantValue: true, capacity: true, power: true, dimensions: true, product: { select: { sku: true, name: true } } },
    orderBy: { id: 'asc' },
  });
  const changes: Array<{ id: number; sku: string | null; product: string; set: Partial<Record<Col, string>>; before: Partial<Record<Col, string | null>> }> = [];
  for (const v of variants) {
    const set: Partial<Record<Col, string>> = {};
    for (const [name, val] of axes(v.variantType, v.variantValue)) {
      const hit = AXIS_TO_COL.find(([re]) => re.test(name));
      if (!hit || !val) continue;
      const col = hit[1];
      if (!v[col] && !set[col]) set[col] = val.slice(0, col === 'dimensions' ? 120 : 80);
    }
    if (Object.keys(set).length) {
      changes.push({ id: v.id, sku: v.skuSuffix, product: v.product.name, set, before: { capacity: v.capacity, power: v.power, dimensions: v.dimensions } });
    }
  }
  const products = new Set(changes.map((c) => c.product));
  console.log(`variants scanned ${variants.length} | to fill ${changes.length} across ${products.size} products${APPLY ? '' : '  [DRY RUN]'}`);
  const show = process.argv.includes('--all') ? changes.length : 60;
  for (const c of changes.slice(0, show)) console.log(`  ${String(c.sku).padEnd(20)} ${JSON.stringify(c.set)}  | ${c.product.slice(0, 50)}`);
  if (changes.length > show) console.log(`  … ${changes.length - show} more (use --all)`);
  if (!APPLY) { await prisma.$disconnect(); return; }
  const backup = `backup-variant-specs-fill-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(backup, JSON.stringify(changes, null, 2));
  for (const c of changes) await prisma.productVariant.update({ where: { id: c.id }, data: c.set });
  console.log(`applied ${changes.length} | backup ${backup}`);
  await prisma.$disconnect();
})();
