/** Corrected copy of the owner's 19-SKU food lamp warmer document (28 Sep 2026).
 *
 *  What the document got wrong, and what this changes:
 *  - All six Rose Gold entries said "The Gold finish" and "Gold Finish:
 *    Finished in Gold" — copied from the Gold entry. Now Rose Gold.
 *  - The two tiltable double-head U-shaped lamps (#16, #17) claimed "top +
 *    bottom warming", copied from the Double Head base-heating model. Their
 *    name carries no bottom heating and the listing's power is bulb-only
 *    (the Top + Bottom models carry extra base wattage: 340 / 615 / 865 W).
 *    They now use the U-shaped family's own "focused overhead warming".
 *  - 18 of 19 SEO titles ran 75-111 characters; written to fit 60.
 *  - 16 of 19 meta descriptions were cut mid-phrase ("catering and.",
 *    "hotel,."); rewritten to end cleanly within 160.
 *
 *  Usage: node scripts/annotate-lamp-warmer-doc.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const SRC = 'scripts/docs/Kitchenary_Kart_Food_Lamp_Warmer_All_19_With_SKU.txt';
const OUT = 'scripts/docs/lamp-warmer-19-annotated.txt';
const BRAND = ' | Kitchenary Kart';

/** Per SKU: title (without brand) and meta description. Specs are the listing's own. */
const SEO = {
  'KKBT0106-FLWVSS': ['V-Shape Hanging Food Lamp Warmer Silver',
    'Shop the Silver V-shaped hanging food lamp warmer, 275W, from Kitchenary Kart. Focused overhead warmth for buffets, pass counters, hotels and catering.'],
  'KKBT0107-FLWVG': ['V-Shape Hanging Food Lamp Warmer Gold',
    'Shop the Gold V-shaped hanging food lamp warmer, 275W, from Kitchenary Kart. Focused overhead warmth for buffets, pass counters, hotels and catering.'],
  'KKBT0108-FLWVRG': ['V-Shape Hanging Food Lamp Warmer Rose Gold',
    'Shop the Rose Gold V-shaped hanging food lamp warmer, 275W, from Kitchenary Kart. Focused overhead warmth for buffets, pass counters and catering.'],

  'KKBT0109-FLWSSS': ['Single Head Food Lamp Warmer Silver',
    'Shop the Silver single-head food lamp warmer with top + bottom heating, 340W, from Kitchenary Kart. Keeps dishes warm on buffets and counters.'],
  'KKBT0110-FLWSG': ['Single Head Food Lamp Warmer Gold',
    'Shop the Gold single-head food lamp warmer with top + bottom heating, 340W, from Kitchenary Kart. Keeps dishes warm on buffets and counters.'],
  'KKBT0111-FLWSRG': ['Single Head Food Lamp Warmer Rose Gold',
    'Shop the Rose Gold single-head food lamp warmer with top + bottom heating, 340W, from Kitchenary Kart. Keeps dishes warm on buffets and counters.'],

  'KKBT0103-FLWDSS': ['Double Head Food Lamp Warmer Silver',
    'Shop the Silver double-head food lamp warmer with top + bottom heating, 615W, from Kitchenary Kart. Keeps dishes warm on buffets and counters.'],
  'KKBT0104-FLWDG': ['Double Head Food Lamp Warmer Gold',
    'Shop the Gold double-head food lamp warmer with top + bottom heating, 615W, from Kitchenary Kart. Keeps dishes warm on buffets and counters.'],
  'KKBT0105-FLEDRG': ['Double Head Food Lamp Warmer Rose Gold',
    'Shop the Rose Gold double-head food lamp warmer with top + bottom heating, 615W, from Kitchenary Kart. Keeps dishes warm on buffets and counters.'],

  'KKBT0117-FLWTSS': ['Triple Head Food Lamp Warmer Silver',
    'Shop the Silver triple-head food lamp warmer with top + bottom heating, 865W, from Kitchenary Kart. Keeps a row of dishes warm on buffet counters.'],
  'KKBT0118-FLWTG': ['Triple Head Food Lamp Warmer Gold',
    'Shop the Gold triple-head food lamp warmer with top + bottom heating, 865W, from Kitchenary Kart. Keeps a row of dishes warm on buffet counters.'],
  'KKBT0119-FLWTRG': ['Triple Head Food Lamp Warmer Rose Gold',
    'Shop the Rose Gold triple-head food lamp warmer with top + bottom heating, 865W, from Kitchenary Kart. Keeps a row of dishes warm on buffet counters.'],

  'KKBT0112-FLWUSS': ['U-Shape Food Lamp Warmer 86cm Silver',
    'Shop the Silver tiltable U-shaped standing food lamp warmer, 86cm tall, 275W, from Kitchenary Kart. Overhead warmth for buffets, counters and catering.'],
  'KKBT0113-FLWUG': ['U-Shape Food Lamp Warmer 86cm Gold',
    'Shop the Gold tiltable U-shaped standing food lamp warmer, 86cm tall, 275W, from Kitchenary Kart. Overhead warmth for buffets, counters and catering.'],
  'KKBT0114-FLWURG': ['U-Shape Food Lamp Warmer 86cm Rose Gold',
    'Shop the Rose Gold tiltable U-shaped standing food lamp warmer, 86cm tall, 275W, from Kitchenary Kart. Overhead warmth for buffets and catering.'],

  'KKBT0115-FLWTUDHG': ['U-Shape Double Head Lamp Warmer Gold',
    'Shop the Gold tiltable double-head U-shaped food lamp warmer with two 275W bulbs, from Kitchenary Kart. Overhead warmth for buffets and catering.'],
  'KKBT0116-FLWTUDHRG': ['U-Shape Double Head Lamp Warmer Rose Gold',
    'Shop the Rose Gold tiltable double-head U-shaped food lamp warmer with two 275W bulbs, from Kitchenary Kart. Overhead warmth for buffets and catering.'],

  // The document's own bulb title and meta were already right.
  'KKSP0139-SFLW1': ['Bulb Spare for Electric Food Lamp Warmer',
    'Shop Spares for Electric Food Lamp Warmer - Bulb from Kitchenary Kart for buffet, restaurant, hotel, catering and food-service warming setups.'],
  'KKSP0140-SFLW2': ['Lamp Warmer Temperature Controller + Knob',
    'Replacement temperature controller + knob for Kitchenary Kart electric food lamp warmers. Compare it with the part in your warmer before ordering.'],
};

const lines = readFileSync(SRC, 'utf8').split(/\r?\n/);
const out = [];
let heading = '';
let sku = '';
let expecting = null;
const seen = new Set();
const edits = { rose: 0, heating: 0, title: 0, meta: 0 };

for (let line of lines) {
  if (line.startsWith('[Heading1]')) { heading = line; sku = ''; }
  const m = /SKU:\s*(\S+)/.exec(line);
  if (m && line.startsWith('[b] SKU:')) sku = m[1];
  const rose = /Rose Gold/.test(heading);
  const uDouble = /Tiltable Double Head U-Shaped/.test(heading);

  if (expecting) {
    const [title, meta] = SEO[sku] ?? [];
    if (!title) throw new Error(`no SEO entry for ${sku}`);
    line = expecting === 'title' ? `[] ${title}${BRAND}` : `[] ${meta}`;
    edits[expecting === 'title' ? 'title' : 'meta']++;
    expecting = null;
    out.push(line);
    continue;
  }
  if (/^\[Heading2\] SEO Title$/.test(line)) { expecting = 'title'; seen.add(sku); }
  if (/^\[Heading2\] Meta Description$/.test(line)) expecting = 'meta';

  if (rose) {
    const before = line;
    line = line
      .replace('The Gold finish gives', 'The Rose Gold finish gives')
      .replace('Gold Finish: Finished in Gold for', 'Rose Gold Finish: Finished in Rose Gold for')
      .replace(/\bgold heat lamp\b/, 'rose gold heat lamp');
    if (line !== before && !/heat lamp/.test(before)) edits.rose++;
  }
  if (uDouble && line.includes('This double-head standing food warmer is designed to provide top + bottom warming')) {
    line = line.replace(
      'This double-head standing food warmer is designed to provide top + bottom warming',
      'This tiltable double-head U-shaped standing food warmer is designed to provide focused overhead warming',
    );
    edits.heating++;
  }
  out.push(line);
}

// Refuse rather than emit something the apply scripts would reject later.
const titles = new Map();
for (const [s, [t, d]] of Object.entries(SEO)) {
  const full = t + BRAND;
  if (full.length > 60) throw new Error(`${s}: title ${full.length} > 60 — ${full}`);
  if (d.length > 160) throw new Error(`${s}: meta ${d.length} > 160 — ${d}`);
  if (!/[.!]$/.test(d)) throw new Error(`${s}: meta does not end a sentence`);
  if (titles.has(full)) throw new Error(`${s}: duplicate title of ${titles.get(full)}`);
  titles.set(full, s);
  if (!seen.has(s)) throw new Error(`${s}: in the SEO table but not in the document`);
}
if (seen.size !== Object.keys(SEO).length) throw new Error(`document has ${seen.size} SKUs, table has ${Object.keys(SEO).length}`);

writeFileSync(OUT, out.join('\n'));
console.log(`${OUT}\n  rose gold lines fixed: ${edits.rose} · heating claims fixed: ${edits.heating} · titles: ${edits.title} · metas: ${edits.meta}`);
for (const [s, [t, d]] of Object.entries(SEO)) console.log(`  ${s.padEnd(20)} T${String((t + BRAND).length).padStart(3)}  M${String(d.length).padStart(4)}  ${t}`);
