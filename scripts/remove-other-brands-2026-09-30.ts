/** Owner 30 Sep 2026: "Kitchenary Kart, VAMA and Veratti — keeps only these
 *  brand" → "okay apply". Five listings carried another brand in the name and
 *  copy (Honest, Burnomatic, Minimax, Honeyson, Marado); renamed as approved
 *  and the brand word removed from description, SEO title/description and
 *  keywords. Refuses if a brand word would remain or a new title duplicates
 *  another product's.  Usage: npx tsx scripts/remove-other-brands-2026-09-30.ts [--apply]
 */
import { writeFileSync } from 'fs';
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');
const JOBS: Array<{ sku: string; brand: string; name: string; swaps: Array<[RegExp, string]> }> = [
  { sku: 'KKA0019-HBT', brand: 'Honest', name: 'Cooking Blow Torch with Standing Base', swaps: [
    [/Honest Original Kitchen Blow Torch/g, 'Cooking Blow Torch with Standing Base'],
    [/Honest Original Blow Torch/g, 'Cooking Blow Torch with Standing Base'],
    [/the Honest Original blow torch/g, 'the cooking blow torch with standing base'],
    [/honest, origianal, /g, ''],
  ] },
  { sku: 'KKHRE0054-BHP', brand: 'Burnomatic', name: 'Electric Double Decanter Warmer - 160W Hot Plate with Dual Heating Zones', swaps: [
    [/burnomatic, /g, ''],
  ] },
  { sku: 'KKHRE0055-MHP', brand: 'Minimax', name: 'Electric Dual Heating Hot Plate with Cordless Kettle 2L & Coffee Maker with Filtration', swaps: [
    [/Minimax /g, ''],
    [/minimax, /g, ''],
  ] },
  { sku: 'KKHRE0056-HOK1.2L', brand: 'Honeyson', name: 'Electric Kettle 1.2L with Tray', swaps: [
    [/Electric Honeyson Kettle/g, 'Electric Kettle'],
    [/Honeyson Electric Kettle/g, 'Electric Kettle'],
    [/honeyson, /g, ''],
  ] },
  { sku: 'KKHRE0058-MK1.2L', brand: 'Marado', name: 'Electric Premium Kettle - 1.2L', swaps: [
    [/Premium Marado /g, 'Premium '],
    [/marado, /g, ''],
  ] },
];
const FIELDS = ['description', 'metaTitle', 'metaDescription', 'metaKeywords'] as const;

(async () => {
  const refused: string[] = [];
  const updates: Array<{ id: number; sku: string; data: Record<string, string> }> = [];
  const backup: unknown[] = [];
  for (const j of JOBS) {
    const p = await prisma.product.findUniqueOrThrow({ where: { sku: j.sku }, select: { id: true, sku: true, name: true, description: true, metaTitle: true, metaDescription: true, metaKeywords: true } });
    backup.push(p);
    const data: Record<string, string> = { name: j.name };
    for (const f of FIELDS) {
      let t = p[f] ?? '';
      for (const [re, to] of j.swaps) t = t.replace(re, to);
      if (t !== (p[f] ?? '')) data[f] = t;
      if (new RegExp(j.brand, 'i').test(t)) refused.push(`${j.sku}: "${j.brand}" still in ${f}: ${t.slice(0, 90)}`);
    }
    const title = data.metaTitle ?? p.metaTitle;
    if (title) {
      if (title.length > 60) refused.push(`${j.sku}: title ${title.length}`);
      const dup = await prisma.product.findFirst({ where: { metaTitle: title, id: { not: p.id } }, select: { sku: true } });
      if (dup) refused.push(`${j.sku}: title "${title}" already used by ${dup.sku}`);
    }
    updates.push({ id: p.id, sku: j.sku, data });
    console.log(`${j.sku.padEnd(18)} ${p.name}\n${' '.repeat(19)}→ ${j.name}${data.metaTitle ? `\n${' '.repeat(19)}title → ${data.metaTitle}` : ''}\n${' '.repeat(19)}fields: ${Object.keys(data).join(', ')}`);
  }
  if (refused.length) { console.log(`\nREFUSED — nothing written:\n  ${refused.join('\n  ')}`); process.exitCode = 1; return; }
  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply'); return; }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  writeFileSync(`backup-remove-brands-${stamp}.json`, JSON.stringify(backup, null, 2));
  await prisma.$transaction(updates.map((u) => prisma.product.update({ where: { id: u.id }, data: u.data })));
  console.log(`\n${updates.length} written · backup backup-remove-brands-${stamp}.json`);
})().finally(() => prisma.$disconnect());
