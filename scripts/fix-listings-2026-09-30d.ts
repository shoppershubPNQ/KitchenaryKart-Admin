/** Owner answers, 30 Sep 2026:
 *   - Round pizza lifters 10"/12" are SS (supplier photo text says aluminium —
 *     owner overrules): say stainless steel in the copy; KKA0221 material field
 *     "Wooden" → "Stainless Steel".
 *   - "Silicon" is the store's spelling: copy written today said "silicone" —
 *     aligned to "silicon" in descriptions and SEO text, and the one product
 *     name that said "Silicone" (KKA0293) follows.
 *  Usage: npx tsx scripts/fix-listings-2026-09-30d.ts [--apply]
 */
import { writeFileSync } from 'fs';
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');
const toSilicon = (s: string) => s.replace(/Silicone/g, 'Silicon').replace(/silicone/g, 'silicon').replace(/SILICONE/g, 'SILICON');

const LIFTERS: Array<{ sku: string; edits: Array<[string, string]>; material?: [string, string] }> = [
  { sku: 'KKA0220-WRPL10', edits: [
    ['has a 10 inch round blade on a short wooden handle', 'has a 10 inch round stainless steel blade on a short wooden handle'],
    ['• 10 inch Round Blade: Fits a medium pizza.', '• 10 inch SS Blade: Fits a medium pizza.'],
    ['Kitchenary Kart 10in round pizza lifter with a wooden handle', 'Kitchenary Kart 10in round SS pizza lifter with a wooden handle'],
  ] },
  { sku: 'KKA0221-WRPL12', edits: [
    ['has a 12 inch round blade, a riveted wooden handle', 'has a 12 inch round stainless steel blade, a riveted wooden handle'],
    ['• 12 inch Round Blade: Holds a large pizza.', '• 12 inch SS Blade: Holds a large pizza.'],
    ['Kitchenary Kart 12in round pizza lifter with a riveted wooden handle', 'Kitchenary Kart 12in round SS pizza lifter with a riveted wooden handle'],
  ], material: ['Wooden', 'Stainless Steel'] },
];

(async () => {
  const refused: string[] = [];
  const backup: unknown[] = [];
  const pUpd = new Map<number, Record<string, string>>();
  const vUpd = new Map<number, Record<string, string>>();

  for (const l of LIFTERS) {
    const p = await prisma.product.findUniqueOrThrow({ where: { sku: l.sku }, select: { id: true, sku: true, material: true, description: true, metaDescription: true } });
    backup.push({ table: 'product', ...p });
    const u: Record<string, string> = { description: p.description ?? '', metaDescription: p.metaDescription ?? '' };
    for (const [from, to] of l.edits) {
      const f = u.description.includes(from) ? 'description' : u.metaDescription.includes(from) ? 'metaDescription' : null;
      if (!f) { refused.push(`${l.sku}: "${from.slice(0, 50)}" not found`); continue; }
      u[f] = u[f].replace(from, to);
    }
    if (u.metaDescription.length > 160) refused.push(`${l.sku}: meta ${u.metaDescription.length}`);
    if (l.material) {
      if (p.material !== l.material[0]) refused.push(`${l.sku}: material is ${p.material}`);
      else u.material = l.material[1];
    }
    pUpd.set(p.id, u);
  }

  const ps = await prisma.product.findMany({ where: { OR: [{ description: { contains: 'ilicone' } }, { metaTitle: { contains: 'ilicone' } }, { metaDescription: { contains: 'ilicone' } }, { name: { contains: 'ilicone' } }] }, select: { id: true, sku: true, name: true, description: true, metaTitle: true, metaDescription: true } });
  for (const p of ps) {
    backup.push({ table: 'product', ...p });
    const u = pUpd.get(p.id) ?? {};
    for (const f of ['name', 'description', 'metaTitle', 'metaDescription'] as const) {
      const cur = u[f] ?? p[f];
      if (cur && /ilicone/i.test(cur)) u[f] = toSilicon(cur);
    }
    pUpd.set(p.id, u);
  }
  const vs = await prisma.productVariant.findMany({ where: { OR: [{ description: { contains: 'ilicone' } }, { metaTitle: { contains: 'ilicone' } }, { metaDescription: { contains: 'ilicone' } }] }, select: { id: true, skuSuffix: true, description: true, metaTitle: true, metaDescription: true } });
  for (const v of vs) {
    backup.push({ table: 'variant', ...v });
    const u: Record<string, string> = {};
    for (const f of ['description', 'metaTitle', 'metaDescription'] as const) if (v[f] && /ilicone/i.test(v[f]!)) u[f] = toSilicon(v[f]!);
    vUpd.set(v.id, u);
  }

  for (const [id, u] of pUpd) console.log(`P#${id} ${Object.keys(u).join(', ')}${u.name ? ` · name → ${u.name}` : ''}`);
  console.log(`${vUpd.size} size option row(s) with silicone → silicon`);
  if (refused.length) { console.log(`\nREFUSED — nothing written:\n  ${refused.join('\n  ')}`); process.exitCode = 1; return; }
  if (!APPLY) { console.log('DRY RUN — re-run with --apply'); return; }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  writeFileSync(`backup-listing-fixes-d-${stamp}.json`, JSON.stringify(backup, null, 2));
  await prisma.$transaction([
    ...[...pUpd].map(([id, data]) => prisma.product.update({ where: { id }, data })),
    ...[...vUpd].map(([id, data]) => prisma.productVariant.update({ where: { id }, data })),
  ]);
  console.log(`${pUpd.size} product + ${vUpd.size} size option row(s) written · backup backup-listing-fixes-d-${stamp}.json`);
})().finally(() => prisma.$disconnect());
