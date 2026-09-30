/** Owner-approved 30 Sep 2026 ("yes"):
 *   1. Spelling in product text: "Origianal" → "Original" (blow torch),
 *      "Cannister" → "Canister" (VAMA set), "VERATTI" → "Veratti" (house brand
 *      — chopping boards and the deep fryer). Every text field that holds the
 *      typo is fixed, not just the name.
 *   2. KKA0426-SSCFS: its photos show a lever-valve batter/sauce dispenser
 *      funnel on a wire stand, not a strainer — renamed and described as one.
 *      Sizes are the ones printed on its own photo (13 cm top, 16 cm cone,
 *      21 cm with stand, 12 cm stand base).
 *
 *  A row whose text no longer contains the expected typo is refused.
 *
 *  Usage: npx tsx scripts/fix-names-2026-09-30.ts [--apply]
 */
import { writeFileSync } from 'fs';
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');
const FIELDS = ['name', 'description', 'metaTitle', 'metaDescription', 'metaKeywords'] as const;
type Field = (typeof FIELDS)[number];

const SPELLING: Array<{ id: number; sku: string; from: RegExp; to: string; expect: string }> = [
  { id: 1960, sku: 'KKA0019-HBT', from: /Origianal/g, to: 'Original', expect: 'Origianal' },
  { id: 2151, sku: 'KKA0295-V4.1GOSCWB', from: /Cannister/g, to: 'Canister', expect: 'Cannister' },
  { id: 1979, sku: 'KKA0049-CBRES', from: /VERATTI/g, to: 'Veratti', expect: 'VERATTI' },
  { id: 1980, sku: 'KKA0052-CBROS', from: /VERATTI/g, to: 'Veratti', expect: 'VERATTI' },
  { id: 2614, sku: 'KKHE0103-VDF3L', from: /VERATTI/g, to: 'Veratti', expect: 'VERATTI' },
];

const DISPENSER = {
  id: 2227,
  sku: 'KKA0426-SSCFS',
  expectName: 'SS Conical Funnel Strainer with Stand',
  data: {
    name: 'SS Conical Funnel Batter Dispenser with Stand',
    description: [
      'Pour batter and sauce exactly where you want it.',
      '',
      'The Kitchenary Kart SS Conical Funnel Batter Dispenser with Stand is a stainless steel cone with a spring-loaded lever on the handle. Squeeze the lever to open the tip and release an even stream; let go and the flow stops.',
      '',
      'Fill it with appe, takoyaki or pancake batter to portion each cavity evenly, or with caramel and chocolate sauce to finish desserts. The wire stand holds the funnel upright while you fill it and between uses.',
      '',
      'Key Features',
      '',
      '• Lever-Controlled Tip: Opens and closes the outlet with one hand.',
      '• Conical Body: About 13 cm across the top and 16 cm deep, narrowing to a fine outlet.',
      '• Wire Stand: Holds the funnel upright, about 21 cm tall together on a 12 cm base.',
      '',
      'Suitable for: Appe, takoyaki and pancake batter, cupcake mixture and dessert sauces.',
      '',
      'Care & Use: Stand the funnel in its holder before filling. Rinse straight after use so batter does not dry in the tip, then wash the cone and valve rod and dry fully.',
    ].join('\n'),
    metaTitle: 'SS Batter Dispenser Funnel with Stand | Kitchenary Kart',
    metaDescription: 'Kitchenary Kart SS conical funnel batter dispenser with a lever-controlled tip and wire stand, for appe, takoyaki and pancake batter or dessert sauces.',
    metaKeywords: 'batter dispenser, conical funnel, pancake batter dispenser, takoyaki, appe, sauce dispenser, funnel with stand, accessories, commercial, restaurant, hotel, cloud kitchen, food service, horeca, GST invoice',
    dimensions: '13cm (top) x 21cm (H with stand)',
  },
};

(async () => {
  const ids = [...SPELLING.map((s) => s.id), DISPENSER.id];
  const rows = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true, name: true, description: true, metaTitle: true, metaDescription: true, metaKeywords: true, dimensions: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const updates: Array<{ id: number; sku: string; data: Partial<Record<Field | 'dimensions', string>> }> = [];
  const refused: string[] = [];

  for (const s of SPELLING) {
    const r = byId.get(s.id);
    if (!r || r.sku !== s.sku) { refused.push(`${s.sku}: row #${s.id} not found under this SKU`); continue; }
    const data: Partial<Record<Field, string>> = {};
    for (const f of FIELDS) {
      const v = r[f];
      if (v && v.includes(s.expect)) data[f] = v.replace(s.from, s.to);
    }
    if (!Object.keys(data).length) { refused.push(`${s.sku}: "${s.expect}" not found in any field`); continue; }
    updates.push({ id: s.id, sku: s.sku, data });
    console.log(`${s.sku.padEnd(20)} ${Object.keys(data).join(', ')}${data.name ? `\n    name → ${data.name}` : ''}`);
  }

  const d = byId.get(DISPENSER.id);
  if (!d || d.sku !== DISPENSER.sku) refused.push(`${DISPENSER.sku}: row not found`);
  else if (d.name !== DISPENSER.expectName && d.name !== DISPENSER.data.name) refused.push(`${DISPENSER.sku}: name is now "${d.name}"`);
  else {
    if (DISPENSER.data.metaTitle.length > 60 || DISPENSER.data.metaDescription.length > 160) throw new Error('KKA0426 meta too long');
    updates.push({ id: DISPENSER.id, sku: DISPENSER.sku, data: DISPENSER.data });
    console.log(`${DISPENSER.sku.padEnd(20)} name, description, SEO, dimensions\n    name → ${DISPENSER.data.name}`);
  }

  if (refused.length) {
    console.log(`\nREFUSED — nothing written:\n  ${refused.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }
  if (!APPLY) { console.log(`\n${updates.length} row(s). DRY RUN — re-run with --apply`); return; }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  writeFileSync(`backup-names-${stamp}.json`, JSON.stringify(rows, null, 2));
  await prisma.$transaction(updates.map((u) => prisma.product.update({ where: { id: u.id }, data: u.data })));
  const after = await prisma.product.findMany({ where: { id: { in: ids } }, select: { sku: true, name: true } });
  for (const a of after) console.log(`saved ${a.sku}: ${a.name}`);
  console.log(`${updates.length} written · backup backup-names-${stamp}.json`);
})().finally(() => prisma.$disconnect());
