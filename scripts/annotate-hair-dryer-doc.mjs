/** Corrected copy of the owner's 4-SKU hair dryer document (28 Sep 2026).
 *
 *  - KKHRE0034 sold itself against its siblings three times ("the higher-rated
 *    option among these listed wall-mountable hair dryers"). Descriptions
 *    never compare one listing with another (owner rule), so each is rewritten
 *    to describe the dryer on its own.
 *  - "Suitable For:" → "Suitable for:", the house label.
 *  - Two SEO titles ran 66 characters; " for Hotels" dropped.
 *
 *  KKHRE0034's SKU is spelt 1200 while its name, power field and the
 *  partner's listing all say 1300W; the copy follows the three.
 *
 *  Usage: node scripts/annotate-hair-dryer-doc.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const SRC = 'scripts/docs/Kitchenary_Kart_Hair_Dryer_All_4_Product_Descriptions.txt';
const OUT = 'scripts/docs/hair-dryer-4-annotated.txt';

const REPLACE = [
  ['[b] Keep a higher-rated wall-mounted hair dryer ready for guest use.',
   '[b] Keep a 1300W wall-mounted hair dryer ready for guest use.'],
  ['With 1300W rated power, this model is the higher-rated option among these listed wall-mountable hair dryers. The Black finish',
   'With 1300W rated power, it is a practical in-room amenity for hotels, resorts and serviced apartments. The Black finish'],
  ['[ListBullet,b] 1300W Rated Power: Higher rated power among these listed Kitchenary Kart wall-mounted hair dryer models.',
   '[ListBullet,b] 1300W Rated Power: Electric hair dryer rated at 1300W for everyday guest use.'],
  ['[] 1200W Wall Mountable Hair Dryer White for Hotels | Kitchenary Kart',
   '[] 1200W Wall Mountable Hair Dryer White | Kitchenary Kart'],
  ['[] 1300W Wall Mountable Hair Dryer Black for Hotels | Kitchenary Kart',
   '[] 1300W Wall Mountable Hair Dryer Black | Kitchenary Kart'],
];

let text = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
for (const [from, to] of REPLACE) {
  if (!text.includes(from)) throw new Error(`not found: ${from.slice(0, 80)}`);
  text = text.replace(from, to);
}
const labels = (text.match(/^\[b\] Suitable For:/gm) ?? []).length;
text = text.replace(/^\[b\] Suitable For:/gm, '[b] Suitable for:');
if (labels !== 4) throw new Error(`expected 4 "Suitable For" labels, found ${labels}`);
if (/among these listed|higher-rated|higher rated/i.test(text)) throw new Error('a comparison is still in the copy');

// Titles and metas, checked the same way the apply script will.
const lines = text.split('\n');
const titles = [];
lines.forEach((l, i) => {
  if (l === '[Heading2] SEO Title') titles.push(lines[i + 1].slice(3));
  if (l === '[Heading2] Meta Description') {
    const m = lines[i + 1].slice(3);
    if (m.length > 160 || !/[.!]$/.test(m)) throw new Error(`bad meta: ${m}`);
  }
});
if (titles.some((t) => t.length > 60) || new Set(titles).size !== titles.length) throw new Error(`bad titles: ${titles.join(' / ')}`);

writeFileSync(OUT, text);
console.log(OUT, `· ${REPLACE.length} replacements · ${labels} labels`);
for (const t of titles) console.log(`  T${String(t.length).padStart(3)} ${t}`);
