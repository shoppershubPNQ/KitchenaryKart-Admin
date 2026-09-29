/** Corrected copy of the owner's 38-product accessories document (29 Sep 2026):
 *  pepper mills, nozzles, ladles, gloves, dough whisker.
 *
 *  check-doc-vs-listing + a per-section size/colour/count check found no product
 *  fact that differs from the listing. Editorial fixes only:
 *  - Cream 6 / Cream 8 pepper mills were described as "Walnut Brown" (body and a
 *    "Walnut Brown Finish" bullet) — copied from the brown mills; their own
 *    heading, spec list and the listing all say Cream.
 *  - The VAMA grinder set itself against "a traditional manual pepper mill" —
 *    our own wooden mills on the same shelf. Now describes itself.
 *  - "This 6 variant" → "This size-6 variant" (the listing gives these sizes no unit).
 *  - "Suitable For:" → "Suitable for:".
 *  - 15 SEO titles over 60 and 12 metas over 160.
 *
 *  Usage: node scripts/annotate-accessories-38.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const SRC = 'scripts/docs/Kitchenary_Kart_Pepper_Mill_Nozzle_Ladle_Gloves_Dough_Whisker_38_Product_Descriptions.txt';
const OUT = 'scripts/docs/accessories-38-annotated.txt';
const BRAND = ' | Kitchenary Kart';

const TITLES = {
  'KKA0320-VALSPG': 'VAMA Electric LED Salt & Pepper Grinder',
  'KKA0273-YG34': 'SS Balloon Nozzle 4pc Set with Piping Bag',
  'KKA0280-SSN52': 'SS Nozzle 52pc Set in White Box',
  'KKA0286-2-2-18': 'SS Russian Nozzle 12pc with Piping Bag',
  'KKA0289-YG19': 'SS Russian & Balloon Nozzle 13pc - YG19',
  'KKA0198-SSCOL25': 'SS Flat Bottom Oil/Milk Ladle 25ml',
  'KKA0199-SSCOL50': 'SS Flat Bottom Oil/Milk Ladle 50ml',
  'KKA0200-SSCOL125': 'SS Flat Bottom Oil/Milk Ladle 125ml',
  'KKA0201-SSCOL250': 'SS Flat Bottom Oil/Milk Ladle 250ml',
  'KKA0202-SSCOL500': 'SS Flat Bottom Oil/Milk Ladle 500ml',
  'KKA0204-SLS': 'Mirror Finish Soup Ladle 120ml Silver',
  'KKA0205-SLG': 'Mirror Finish Soup Ladle 120ml Gold',
  'KKA0206-SLRG': 'Mirror Finish Soup Ladle 120ml Rose Gold',
  'KKA0122-MWCRG': 'Cut Resistant Metal Wire Gloves XL',
};

/** Meta tails shortened only where the meta runs over 160. */
const META_TAILS = [
  [' for convenient seasoning and pepper grinding in restaurants, hotels, cafés and dining setups.', ' for convenient seasoning in restaurants, hotels, cafés and dining setups.'],
  [' for cake, cupcake, cream and dessert piping in bakery, pastry and catering setups.', ' for cake, cupcake and cream piping in bakeries and catering.'],
  [' for practical cooking, portioning and serving use in restaurants, hotels, cafés and kitchens.', ' for portioning and serving in restaurants, hotels, cafés and kitchens.'],
];

const CREAM = new Set(['KKA0321-WPMC6', 'KKA0322-WPMC8']);
let text = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

const vama = 'while the LED feature helps distinguish this model from a traditional manual pepper mill.';
if (!text.includes(vama)) throw new Error('VAMA comparison line not found');
text = text.replace(vama, 'while the LED feature adds a visible light during operation.');

const lines = text.split('\n');
let sku = '';
const done = { cream: 0, size: 0, label: 0, title: 0, meta: 0 };
const titles = new Map();
for (let i = 0; i < lines.length; i++) {
  let l = lines[i];
  if (l.startsWith('[b] SKU:')) sku = l.replace('[b] SKU:', '').trim();
  if (CREAM.has(sku)) {
    const before = l;
    l = l.replace('Wooden Pepper Mill in Walnut Brown is', 'Wooden Pepper Mill in Cream is')
         .replace('Walnut Brown Finish: Offers a walnut brown appearance', 'Cream Finish: Offers a cream appearance');
    if (l !== before) done.cream++;
  }
  const sized = l.replace(/\bThis (\d+) variant\b/, 'This size-$1 variant');
  if (sized !== l) { l = sized; done.size++; }
  if (l.startsWith('[b] Suitable For:')) { l = l.replace('Suitable For:', 'Suitable for:'); done.label++; }
  lines[i] = l;

  if (l === '[Heading2] SEO Title') {
    if (TITLES[sku]) { lines[i + 1] = `[] ${TITLES[sku]}${BRAND}`; done.title++; }
    const t = lines[i + 1].slice(3);
    if (t.length > 60) throw new Error(`${sku}: title ${t.length} — ${t}`);
    if (titles.has(t)) throw new Error(`${sku}: duplicate title of ${titles.get(t)}`);
    titles.set(t, sku);
  }
  if (l === '[Heading2] Meta Description') {
    let m = lines[i + 1].slice(3);
    if (m.length > 160) {
      for (const [from, to] of META_TAILS) if (m.endsWith(from)) m = m.slice(0, -from.length) + to;
      lines[i + 1] = `[] ${m}`;
      done.meta++;
    }
    if (m.length > 160 || !/[.!]$/.test(m)) throw new Error(`${sku}: meta ${m.length} — ${m}`);
  }
}
const out = lines.join('\n');
if (/Walnut Brown/.test(out.split('[Heading1] 4.')[0].split('[Heading1] 2.')[1] ?? '')) throw new Error('Walnut Brown still on a Cream mill');
if (/traditional manual pepper mill/.test(out)) throw new Error('VAMA comparison still present');
if (done.cream !== 4 || done.label !== 38 || done.title !== Object.keys(TITLES).length) throw new Error(`unexpected counts ${JSON.stringify(done)}`);
writeFileSync(OUT, out);
console.log(OUT, JSON.stringify(done), `· ${titles.size} titles unique`);
