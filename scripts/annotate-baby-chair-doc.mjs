/** Corrected copy of the owner's 3-SKU baby chair document (28 Sep 2026).
 *
 *  - "Suitable For:" → "Suitable for:", the house label every other
 *    description uses (and the one apply-description-docs checks for).
 *  - Two SEO titles ran 65 and 64 characters; written to fit 60.
 *  - The Loose chair and the Carton of 2 both stated "Listed Weight: 5 kg
 *    300 g" — one chair and two chairs cannot weigh the same. Both sizes
 *    inherit that one figure from the parent row, so the bullet is left out
 *    of the copy for these two until the owner confirms which it belongs to.
 *    The wooden chair's 4 kg 600 g stays.
 *
 *  Usage: node scripts/annotate-baby-chair-doc.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const SRC = 'scripts/docs/Kitchenary_Kart_Baby_Chairs_All_3_Customer_Use_SEO_Descriptions.txt';
const OUT = 'scripts/docs/baby-chair-3-annotated.txt';

const TITLES = {
  'KKHRE0002-FBCL': 'ABS Fibre Baby Chair with Removable Cover | Kitchenary Kart',
  'KKHRE0001-FBC': 'ABS Baby Chair Pack of 2 for Restaurants | Kitchenary Kart',
};
const DROP_WEIGHT = new Set(['KKHRE0002-FBCL', 'KKHRE0001-FBC']);

const out = [];
let sku = '';
let expectTitle = false;
const done = { label: 0, title: 0, weight: 0 };
const titles = [];
const metas = [];
let expectMeta = false;

for (let line of readFileSync(SRC, 'utf8').split(/\r?\n/)) {
  if (line.startsWith('[b] SKU:')) sku = line.replace('[b] SKU:', '').trim();

  if (expectTitle) {
    expectTitle = false;
    if (TITLES[sku]) { line = `[] ${TITLES[sku]}`; done.title++; }
    titles.push([sku, line.slice(3)]);
  } else if (expectMeta) {
    expectMeta = false;
    metas.push([sku, line.slice(3)]);
  }
  if (line === '[Heading2] SEO Title') expectTitle = true;
  if (line === '[Heading2] Meta Description') expectMeta = true;

  if (line.startsWith('[b] Suitable For:')) { line = line.replace('Suitable For:', 'Suitable for:'); done.label++; }
  if (DROP_WEIGHT.has(sku) && /^\[ListBullet,b\] Listed Weight:/.test(line)) { done.weight++; continue; }
  out.push(line);
}

const seen = new Set();
for (const [s, t] of titles) {
  if (t.length > 60) throw new Error(`${s}: title ${t.length} > 60 — ${t}`);
  if (seen.has(t)) throw new Error(`${s}: duplicate title ${t}`);
  seen.add(t);
}
for (const [s, m] of metas) {
  if (m.length > 160) throw new Error(`${s}: meta ${m.length} > 160`);
  if (!/[.!]$/.test(m)) throw new Error(`${s}: meta does not end a sentence — ${m}`);
}
if (done.label !== 3 || done.title !== 2 || done.weight !== 2) throw new Error(`unexpected edit counts ${JSON.stringify(done)}`);

writeFileSync(OUT, out.join('\n'));
console.log(OUT, JSON.stringify(done));
for (const [s, t] of titles) console.log(`  ${s.padEnd(16)} T${String(t.length).padStart(3)} ${t}`);
for (const [s, m] of metas) console.log(`  ${s.padEnd(16)} M${String(m.length).padStart(4)} ${m}`);
