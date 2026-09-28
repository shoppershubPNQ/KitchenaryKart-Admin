/** Corrected copy of the owner's 7-SKU housekeeping basket document (28 Sep 2026).
 *
 *  - "Suitable For:" → "Suitable for:", the house label.
 *  - Five SEO titles ran 63-65 characters: the four laundry baskets ("with
 *    Top Cover" → "with Lid") and the caddy. The two table-cleaning basket
 *    titles already fit and are kept.
 *  Nothing else in the copy needed changing.
 *
 *  Usage: node scripts/annotate-basket-doc.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const SRC = 'scripts/docs/Kitchenary_Kart_Basket_All_7_Product_Descriptions.txt';
const OUT = 'scripts/docs/basket-7-annotated.txt';

const TITLES = {
  'KKHRE0007-LBBL': 'Foldable Laundry Basket with Lid - Black | Kitchenary Kart',
  'KKHRE0008-LBGR': 'Foldable Laundry Basket with Lid - Grey | Kitchenary Kart',
  'KKHRE0009-LBBR': 'Foldable Laundry Basket with Lid - Brown | Kitchenary Kart',
  'KKHRE0010-LBBE': 'Foldable Laundry Basket with Lid - Beige | Kitchenary Kart',
  'KKHRE0004-CTB4RS': 'Plastic Cleaning Caddy with 4 Slots - Grey | Kitchenary Kart',
};

const out = [];
let sku = '';
let expect = null;
const titles = [];
const metas = [];
const done = { label: 0, title: 0 };

for (let line of readFileSync(SRC, 'utf8').split(/\r?\n/)) {
  if (line.startsWith('[b] SKU:')) sku = line.replace('[b] SKU:', '').trim();
  if (expect === 'title') {
    if (TITLES[sku]) { line = `[] ${TITLES[sku]}`; done.title++; }
    titles.push([sku, line.slice(3)]);
    expect = null;
  } else if (expect === 'meta') {
    metas.push([sku, line.slice(3)]);
    expect = null;
  }
  if (line === '[Heading2] SEO Title') expect = 'title';
  if (line === '[Heading2] Meta Description') expect = 'meta';
  if (line.startsWith('[b] Suitable For:')) { line = line.replace('Suitable For:', 'Suitable for:'); done.label++; }
  out.push(line);
}

const seen = new Set();
for (const [s, t] of titles) {
  if (t.length > 60) throw new Error(`${s}: title ${t.length} > 60 — ${t}`);
  if (seen.has(t)) throw new Error(`${s}: duplicate title`);
  seen.add(t);
}
for (const [s, m] of metas) {
  if (m.length > 160) throw new Error(`${s}: meta ${m.length} > 160`);
  if (!/[.!]$/.test(m)) throw new Error(`${s}: meta does not end a sentence — ${m}`);
}
if (done.label !== 7 || done.title !== 5 || titles.length !== 7) throw new Error(`unexpected edit counts ${JSON.stringify(done)}`);

writeFileSync(OUT, out.join('\n'));
console.log(OUT, JSON.stringify(done));
for (const [s, t] of titles) console.log(`  ${s.padEnd(17)} T${String(t.length).padStart(3)} ${t}`);
for (const [s, m] of metas) console.log(`  ${s.padEnd(17)} M${String(m.length).padStart(4)}`);
