/** Owner 30 Sep 2026: "kro apply" on the flagged list + "isse or bhi mistake hai
 *  find out kro". Photo-verified fixes and the mistakes the Accessories audit
 *  (scripts/_tmp-audit-listings.ts) turned up:
 *
 *   - KKA0424 / KKA0425: photos show bamboo paddle skewers and pearl cocktail
 *     picks (food use), not drink stirrers — renamed + described as such.
 *   - Hanging "Pump Dispenser" (KKA0366/0367): photos show a hanging squeeze
 *     bottle with a nozzle — "Pump" → "Squeeze" in name, titles and copy.
 *   - "SS Tank" sauce dispensers + their spares: photos show a steel outer box
 *     with a plastic inner tank — "SS Tank" → "SS Body".
 *   - Name typos: witth, Prodective, Decorater, Smily, Boc, "with for", Tatoo,
 *     trailing space on KKA0493.
 *   - Fields: KKA0306 capacity 6.5L → 6.75L (as its name); material "Wooden" on
 *     metal/steel products whose handle only is wood (KKA0312, KKA0427, KKA0219).
 *
 *  Each text change requires the old wording to be present (else refused).
 *  Usage: npx tsx scripts/fix-listings-2026-09-30b.ts [--apply]
 */
import { writeFileSync } from 'fs';
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');
type PF = 'name' | 'description' | 'metaTitle' | 'metaDescription' | 'metaKeywords';
type VF = 'description' | 'metaTitle' | 'metaDescription';

/** product id → [from, to, fields] text replacements */
const PRODUCT_TEXT: Array<{ id: number; sku: string; from: string; to: string; fields: PF[] }> = [
  { id: 2195, sku: 'KKA0366-PHSD3.5', from: 'Liquid Pump Dispenser', to: 'Liquid Squeeze Dispenser', fields: ['name', 'description'] },
  { id: 2195, sku: 'KKA0366-PHSD3.5', from: 'Hanging Sauce Pump Dispenser', to: 'Hanging Sauce Squeeze Dispenser', fields: ['metaTitle'] },
  { id: 2197, sku: 'KKA0370-SSPHSD1', from: 'SS Tank', to: 'SS Body', fields: ['name', 'description'] },
  { id: 2198, sku: 'KKA0372-SSSD1', from: 'SS Tank', to: 'SS Body', fields: ['name', 'description'] },
  { id: 3313, sku: 'KKSP0333-SDPPHWS', from: 'SS Tank', to: 'SS Body', fields: ['name', 'description'] },
  { id: 3314, sku: 'KKSP0334-SDS', from: 'SS Tank', to: 'SS Body', fields: ['name', 'description'] },
  { id: 2236, sku: 'KKA0462-MSWOKRG38', from: 'witth', to: 'with', fields: ['name'] },
  { id: 2032, sku: 'KKA0122-MWCRG', from: 'Prodective', to: 'Protective', fields: ['name'] },
  { id: 2130, sku: 'KKA0273-YG34', from: 'Decorater', to: 'Decorator', fields: ['name'] },
  { id: 1973, sku: 'KKA0035-TFP', from: 'Smily', to: 'Smiley', fields: ['name', 'description'] },
  { id: 1971, sku: 'KKA0032-CIP8S', from: 'Single Pc Boc Packing', to: 'Single Pc Box Packing', fields: ['name'] },
  { id: 1972, sku: 'KKA0033-CIP7S', from: 'Cast Iron Pan with for Appe', to: 'Cast Iron Pan for Appe', fields: ['name'] },
  { id: 2166, sku: 'KKA0310-SGH', from: 'Tatoo', to: 'Tattoo', fields: ['name'] },
  { id: 2167, sku: 'KKA0311-SGL', from: 'Tatoo', to: 'Tattoo', fields: ['name'] },
];
/** variant id → text replacements */
const VARIANT_TEXT: Array<{ id: number; sku: string; from: string; to: string; fields: VF[] }> = [
  { id: 662, sku: 'KKA0366-PHSD3.5', from: 'Pump Dispenser', to: 'Squeeze Dispenser', fields: ['description'] },
  { id: 663, sku: 'KKA0367-PHSD5.5', from: 'Pump Dispenser', to: 'Squeeze Dispenser', fields: ['description', 'metaTitle'] },
  { id: 666, sku: 'KKA0370-SSPHSD1', from: 'SS Tank', to: 'SS Body', fields: ['description'] },
  { id: 667, sku: 'KKA0371-SSPHSD2', from: 'SS Tank', to: 'SS Body', fields: ['description'] },
  { id: 668, sku: 'KKA0372-SSSD1', from: 'SS Tank', to: 'SS Body', fields: ['description'] },
  { id: 669, sku: 'KKA0373-SSSD2', from: 'SS Tank', to: 'SS Body', fields: ['description'] },
];

const desc = (lead: string, p: string[], b: string[], suit: string, care: string) =>
  [lead, '', ...p.flatMap((x) => [x, '']), 'Key Features', '', ...b.map((x) => `• ${x}`), '', `Suitable for: ${suit}`, '', `Care & Use: ${care}`].join('\n');

/** product id → whole-field sets (expected current name guards the row) */
const PRODUCT_SET: Array<{ id: number; sku: string; expectName: string; data: Record<string, string | null> }> = [
  { id: 2225, sku: 'KKA0424-WSS', expectName: 'Wooden Stirrer Sticks - Length: 6" | Quantity ~ 100pp', data: {
    name: 'Wooden Bamboo Paddle Skewers - Length: 6" | Quantity ~ 100pp',
    description: desc('Flat-top bamboo skewers for bites, sliders and fruit.',
      ['The Kitchenary Kart Wooden Bamboo Paddle Skewers - Length: 6" come about 100 to a pack. Each 15 cm bamboo pick has a pointed end and a flat, wide paddle top that keeps food from spinning or sliding off.',
       'Thread paneer tikka, grilled chicken, fruit cubes or a mini burger, and the paddle end gives guests something clean to hold. They also work as drink picks for garnished coolers and mocktails.'],
      ['Paddle Top: A flat, wide handle that stops food turning on the stick.', '15 cm Length: Sized for starters, fruit platters and sliders.', 'Pointed Bamboo Tip: Goes through meat, paneer and fruit cleanly.', 'Pack of About 100: Enough for a buffet counter or party order.'],
      'Barbecue starters, fruit platters, sliders and sandwiches, and garnished drinks.',
      'Single-use: discard after serving. Keep the pack dry and sealed between services, and take care with the pointed tips around children.'),
    metaTitle: 'Bamboo Paddle Skewers 6 Inch, 100 Pcs | Kitchenary Kart',
    metaDescription: 'Kitchenary Kart 6in bamboo paddle skewers, about 100 per pack, with a flat top for tikka, fruit, sliders and garnished drinks at buffets and bars.',
  } },
  { id: 2226, sku: 'KKA0425-WSSWP', expectName: 'Wooden Stirrer Sticks with Pearl - Length: 5" | Quantity ~ 50pp', data: {
    name: 'Wooden Bamboo Pearl Cocktail Picks - Length: 5" | Quantity ~ 50pp',
    description: desc('Pearl-topped picks for cocktails, canapés and cakes.',
      ['The Kitchenary Kart Wooden Bamboo Pearl Cocktail Picks - Length: 5" come about 50 to a pack. Each 12.5 cm bamboo pick ends in a white pearl bead at the top and a sharp point at the other end.',
       'Spear olives, cherries and lemon wheels for cocktails, hold canapés and sausage bites together, or push them into a cake as a finishing touch.'],
      ['Pearl Bead Top: A white bead that dresses up drinks and platters.', '12.5 cm Length: Right for glasses, canapés and cupcakes.', 'Pointed End: Pierces fruit, olives and cheese cubes easily.'],
      'Cocktails and mocktails, canapés, fruit and cheese platters, and cake decoration.',
      'Use once and discard. Store the pack dry, and keep the sharp ends away from children.'),
    metaTitle: 'Pearl Cocktail Picks 5 Inch, 50 Pcs | Kitchenary Kart',
    metaDescription: 'Kitchenary Kart 5in bamboo pearl cocktail picks, about 50 per pack, for garnishing drinks, serving canapés and fruit, and decorating cakes.',
  } },
];
/** plain field sets guarded by the current value */
const FIELD_SET: Array<{ sku: string; field: 'capacity' | 'material' | 'name'; expect: string; to: string }> = [
  { sku: 'KKA0306-PCGNH', field: 'capacity', expect: '6.5L', to: '6.75L' },
  { sku: 'KKA0312-WHMBPP', field: 'material', expect: 'Wooden', to: 'Metal (Wooden Handle)' },
  { sku: 'KKA0427-WHSSNS20', field: 'material', expect: 'Wooden', to: 'Stainless Steel' },
  { sku: 'KKA0219-WRPL6', field: 'material', expect: 'Wooden', to: 'Stainless Steel' },
  { sku: 'KKA0493-GHSSOS30', field: 'name', expect: 'Wooden Handle SS Spider Oil Strainer ', to: 'Wooden Handle SS Spider Oil Strainer' },
];

(async () => {
  const refused: string[] = [];
  const pUpd = new Map<number, Record<string, string | null>>();
  const vUpd = new Map<number, Record<string, string>>();
  const backup: unknown[] = [];

  for (const r of PRODUCT_TEXT) {
    const p = await prisma.product.findUnique({ where: { id: r.id } });
    if (!p || p.sku !== r.sku) { refused.push(`${r.sku}: row #${r.id} not found`); continue; }
    backup.push({ table: 'product', id: p.id, sku: p.sku, name: p.name, description: p.description, metaTitle: p.metaTitle, metaDescription: p.metaDescription });
    const u = pUpd.get(r.id) ?? {};
    for (const f of r.fields) {
      const cur = (u[f] as string | undefined) ?? (p[f] as string | null);
      if (!cur || !cur.includes(r.from)) { refused.push(`${r.sku}: "${r.from}" not in ${f}`); continue; }
      u[f] = cur.split(r.from).join(r.to);
    }
    pUpd.set(r.id, u);
  }
  for (const r of VARIANT_TEXT) {
    const v = await prisma.productVariant.findUnique({ where: { id: r.id } });
    if (!v || v.skuSuffix !== r.sku) { refused.push(`${r.sku}: variant #${r.id} not found`); continue; }
    backup.push({ table: 'variant', id: v.id, sku: v.skuSuffix, description: v.description, metaTitle: v.metaTitle, metaDescription: v.metaDescription });
    const u = vUpd.get(r.id) ?? {};
    for (const f of r.fields) {
      const cur = u[f] ?? v[f];
      if (!cur || !cur.includes(r.from)) { refused.push(`${r.sku}: "${r.from}" not in variant ${f}`); continue; }
      u[f] = cur.split(r.from).join(r.to);
    }
    vUpd.set(r.id, u);
  }
  for (const r of PRODUCT_SET) {
    const p = await prisma.product.findUnique({ where: { id: r.id } });
    if (!p || p.sku !== r.sku || p.name !== r.expectName) { refused.push(`${r.sku}: name is now ${JSON.stringify(p?.name)}`); continue; }
    if ((r.data.metaTitle ?? '').length > 60 || (r.data.metaDescription ?? '').length > 160) throw new Error(`${r.sku} meta too long`);
    backup.push({ table: 'product', id: p.id, sku: p.sku, name: p.name, description: p.description, metaTitle: p.metaTitle, metaDescription: p.metaDescription });
    pUpd.set(r.id, { ...(pUpd.get(r.id) ?? {}), ...r.data });
  }
  for (const r of FIELD_SET) {
    const p = await prisma.product.findUnique({ where: { sku: r.sku } });
    if (!p) { refused.push(`${r.sku}: not found`); continue; }
    if (p[r.field] !== r.expect) { refused.push(`${r.sku}: ${r.field} is ${JSON.stringify(p[r.field])}, expected ${JSON.stringify(r.expect)}`); continue; }
    backup.push({ table: 'product', id: p.id, sku: p.sku, [r.field]: p[r.field] });
    pUpd.set(p.id, { ...(pUpd.get(p.id) ?? {}), [r.field]: r.to });
  }

  for (const [id, u] of pUpd) for (const [k, v] of Object.entries(u)) console.log(`P #${id} ${k.padEnd(15)} → ${String(v).split('\n')[0].slice(0, 110)}`);
  for (const [id, u] of vUpd) for (const [k, v] of Object.entries(u)) console.log(`V #${id} ${k.padEnd(15)} → ${String(v).split('\n')[0].slice(0, 110)}`);
  if (refused.length) { console.log(`\nREFUSED — nothing written:\n  ${refused.join('\n  ')}`); process.exitCode = 1; return; }
  if (!APPLY) { console.log(`\n${pUpd.size} product row(s), ${vUpd.size} variant row(s). DRY RUN — re-run with --apply`); return; }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  writeFileSync(`backup-listing-fixes-${stamp}.json`, JSON.stringify(backup, null, 2));
  await prisma.$transaction([
    ...[...pUpd].map(([id, data]) => prisma.product.update({ where: { id }, data })),
    ...[...vUpd].map(([id, data]) => prisma.productVariant.update({ where: { id }, data })),
  ]);
  console.log(`\n${pUpd.size} product + ${vUpd.size} variant row(s) written · backup backup-listing-fixes-${stamp}.json`);
})().finally(() => prisma.$disconnect());
