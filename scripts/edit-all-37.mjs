/** Hand edits on the owner's 37-product document (30 Sep 2026), applied after
 *  convert-inline-seo-doc.mjs + clean-doc-filler.mjs: four SEO titles over 60
 *  characters, and three descriptions that used their own noun 7–12 times
 *  (owner rule: no repeated words). Every edit must match exactly once.
 *
 *  Usage: node scripts/edit-all-37.mjs <in.txt> <out.txt>
 */
import { readFileSync, writeFileSync } from 'fs';

const [SRC, OUT] = process.argv.slice(2);
let t = readFileSync(SRC, 'utf8');
const EDITS = [
  // titles
  ['[] Full Stainless Steel Half Moon Pizza Cutter | Kitchenary Kart', '[] Full SS Half Moon Pizza Cutter | Kitchenary Kart'],
  ['[] 40 Piece Alphabet and Number Cookie Cutters | Kitchenary Kart', '[] 40 Piece Alphabet & Number Cookie Cutters | Kitchenary Kart'],
  ['[] 36 Piece Alphabet and Number Cookie Cutters | Kitchenary Kart', '[] 36 Piece Alphabet & Number Cookie Cutters | Kitchenary Kart'],
  ['[] 12 Jar Rotating Spice Rack with Glass Bottles | Kitchenary Kart', '[] Rotating Spice Rack with 12 Glass Bottles | Kitchenary Kart'],
  // Premium Chinese broom: brush ×7, cleaning ×6
  ['The stainless steel section helps hold the brush bundle together, while the grip lets you guide it around the pan. It is a useful cleaning accessory', 'The stainless steel section holds the bundle together, while the grip lets you guide it around the pan. It is a handy accessory'],
  ['Handheld Grip: Helps guide the brush around curved cookware.', 'Handheld Grip: Guides the strips around curved cookware.'],
  ['Wok Cleaning Design: Suited to routine cleaning at a Chinese cooking station.', 'Wok Design: Made for routine scrubbing at a Chinese cooking station.'],
  ['Reusable Brush: Rinse after use and dry thoroughly before the next cleaning task.', 'Reusable: Rinse after use and dry thoroughly before the next wash-up.'],
  ['Rinse and air-dry the brush. Avoid soaking, direct flames and use on delicate non-stick coatings.', 'Rinse and air-dry it. Avoid soaking, direct flames and use on delicate non-stick coatings.'],
  // Onion flower cutter: onion(s) ×12
  ['Prepare onions for blooming onion recipes with the Kitchenary Kart Aluminium Onion Flower Cutter. The cutting arrangement creates the flower-style sections used for battering and frying onion blossoms.', 'Prepare whole bulbs for blooming onion recipes with the Kitchenary Kart Aluminium Onion Flower Cutter. The cutting arrangement creates the flower-style sections used for battering and frying the blossom.'],
  ['guides the cutter down through a correctly positioned onion.', 'guides the cutter down through a correctly positioned bulb.'],
  ['Flower-Style Cutting: Sections onions for blooming onion preparation.', 'Flower-Style Cutting: Opens each bulb into petal sections.'],
  ['Suitable for: Preparing onions for blooming onion and onion blossom recipes.', 'Suitable for: Blooming onion and onion blossom recipes.'],
  ['Use onions that fit the cutting area', 'Use bulbs that fit the cutting area'],
  // Cookie press: dough ×7
  ['The lever helps portion dough onto a baking tray', 'The lever portions each biscuit onto a baking tray'],
  ['Dough Cylinder: Holds prepared dough ready for pressing.', 'Filling Cylinder: Holds the prepared mixture ready for pressing.'],
  ['Suitable for: Soft biscuit and cookie dough suitable for a cookie press.', 'Suitable for: Soft biscuit and cookie dough for pressing.'],
  ['Use a smooth dough suited to pressing', 'Use a smooth mixture'],
];
for (const [from, to] of EDITS) {
  const n = t.split(from).length - 1;
  if (n !== 1) throw new Error(`expected 1 match, found ${n}: ${from.slice(0, 70)}`);
  t = t.replace(from, to);
}
for (const m of t.matchAll(/\[Heading2\] SEO Title\n\[\] (.+)/g)) if (m[1].length > 60) throw new Error(`title ${m[1].length}: ${m[1]}`);
writeFileSync(OUT, t);
console.log(`${OUT}: ${EDITS.length} edits`);
