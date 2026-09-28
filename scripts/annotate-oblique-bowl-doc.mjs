/** Corrected copy of the owner's 6-SKU Golden Oblique Bowl + spare lid document (28 Sep 2026).
 *
 *  - "Suitable For:" → "Suitable for:", the house label.
 *  - SEO titles: the three bowls ran 63-70 characters and the Medium lid 61.
 *    Rewritten in one pattern per family so the sizes read alike.
 *  - Weight: the document gives 417 g for all three bowls and 98 g for all
 *    three lids — the parent row's figure, which every size inherits because
 *    none has its own. The Big bowl sells at 1.5x the Small, so one weight
 *    cannot be right for all three. The bullet is left out of the copy until
 *    the owner sends per-size weights (same case as the baby chairs).
 *
 *  Usage: node scripts/annotate-oblique-bowl-doc.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const SRC = 'scripts/docs/Kitchenary_Kart_Golden_Oblique_Bowl_All_6_SEO_Descriptions.txt';
const OUT = 'scripts/docs/oblique-bowl-6-annotated.txt';
const BRAND = ' | Kitchenary Kart';

const TITLES = {
  'KKBT0251-OBS': 'Golden Oblique Bowl with PC Lid, Small',
  'KKBT0252-OBM': 'Golden Oblique Bowl with PC Lid, Medium',
  'KKBT0253-OBB': 'Golden Oblique Bowl with PC Lid, Big',
  'KKSP0226-SOBS': 'Golden Oblique Bowl Spare PC Lid, Small',
  'KKSP0227-SOBM': 'Golden Oblique Bowl Spare PC Lid, Medium',
  'KKSP0228-SOBB': 'Golden Oblique Bowl Spare PC Lid, Big',
};

const out = [];
let sku = '';
let expect = null;
const titles = [];
const metas = [];
const done = { label: 0, title: 0, weight: 0 };

for (let line of readFileSync(SRC, 'utf8').split(/\r?\n/)) {
  if (line.startsWith('[b] SKU:')) sku = line.replace('[b] SKU:', '').trim();

  if (expect === 'title') {
    if (!TITLES[sku]) throw new Error(`no title for ${sku}`);
    line = `[] ${TITLES[sku]}${BRAND}`;
    titles.push([sku, line.slice(3)]);
    done.title++;
    expect = null;
  } else if (expect === 'meta') {
    metas.push([sku, line.slice(3)]);
    expect = null;
  }
  if (line === '[Heading2] SEO Title') expect = 'title';
  if (line === '[Heading2] Meta Description') expect = 'meta';

  if (line.startsWith('[b] Suitable For:')) { line = line.replace('Suitable For:', 'Suitable for:'); done.label++; }
  if (/^\[ListBullet,b\] Listed Weight:/.test(line)) { done.weight++; continue; }
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
if (done.label !== 6 || done.title !== 6 || done.weight !== 6) throw new Error(`unexpected edit counts ${JSON.stringify(done)}`);

writeFileSync(OUT, out.join('\n'));
console.log(OUT, JSON.stringify(done));
for (const [s, t] of titles) console.log(`  ${s.padEnd(15)} T${String(t.length).padStart(3)} ${t}`);
for (const [s, m] of metas) console.log(`  ${s.padEnd(15)} M${String(m.length).padStart(4)} ${m}`);
