/** Corrected copies of two owner documents (28 Sep 2026):
 *  "Other Housekeeping & Room Essentials" (4 SKUs) and "Hotel Room Tray" (6).
 *
 *  Every product fact in both matches the listing (25L, BLDC motor, plastic,
 *  23cm, wooden, glass / rubber base, 2pc / 3pc sets) — editorial fixes only:
 *  - "Suitable For:" → "Suitable for:", the house label.
 *  - SEO titles over 60 shortened; the No.9 tray given the same "2pc Set"
 *    pattern as its siblings.
 *  - The portable glass washer (KKHRE0085) positioned itself against "a
 *    larger electric glass-washing machine" — our own KKHRE0084. Descriptions
 *    never compare listings, so it now describes itself.
 *  - The glass washing machine meta ran over 160; ended at a full stop.
 *
 *  Usage: node scripts/annotate-housekeeping-tray-docs.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const DOCS = [
  {
    src: 'scripts/docs/Kitchenary_Kart_Other_Housekeeping_Room_Essentials_All_4_Descriptions.txt',
    out: 'scripts/docs/other-housekeeping-4-annotated.txt',
    labels: 4,
    replace: [
      ['[b] Make routine glass cleaning easier without adding a large machine to the counter.',
       '[b] Make routine glass cleaning easier with a compact, movable washer.'],
      ['It gives staff a dedicated washing aid for glasses and similar drinkware without requiring the footprint of a larger electric glass-washing machine.',
       'It gives staff a dedicated washing aid for glasses and similar drinkware in a compact format that takes little counter space.'],
      ['[ListBullet,b] Useful for Smaller Counters: Provides a dedicated glass-cleaning aid without requiring a large machine.',
       '[ListBullet,b] Useful for Smaller Counters: Provides a dedicated glass-cleaning aid where counter space is limited.'],
      ['[] Portable Round Plastic Glass Washer for Bar & Cafe | Kitchenary Kart',
       '[] Portable Round Glass Washer for Bar & Cafe | Kitchenary Kart'],
      ['[] 23cm Plastic Triple Brush for Cups Bottles & Glasses | Kitchenary Kart',
       '[] 23cm Triple Glass & Bottle Cleaning Brush | Kitchenary Kart'],
      ['[] Kitchenary Kart Glass Washing Machine with BLDC Motor helps busy bars, cafés and restaurants handle frequent glass cleaning with less repetitive manual scrubbing.',
       '[] Kitchenary Kart Glass Washing Machine with BLDC Motor helps busy bars, cafés and restaurants clean glasses with less repetitive manual scrubbing.'],
    ],
  },
  {
    src: 'scripts/docs/Kitchenary_Kart_Hotel_Room_Tray_All_6_Product_Descriptions.txt',
    out: 'scripts/docs/hotel-room-tray-6-annotated.txt',
    labels: 6,
    replace: [
      ['[] Hotel Wooden Tray with Glass Base No.10 2pc | Kitchenary Kart', '[] Hotel Wooden Tray Glass Base No.10 2pc Set | Kitchenary Kart'],
      ['[] Hotel Room Wooden Tray Glass Base No.9 | Kitchenary Kart', '[] Hotel Wooden Tray Glass Base No.9 2pc Set | Kitchenary Kart'],
      ['[] Hotel Wooden Tray Rubber Base No.47 3pc Set | Kitchenary Kart', '[] Hotel Wooden Tray Rubber Base No.47 3pc | Kitchenary Kart'],
      ['[] Hotel Wooden Tray Rubber Base No.48 3pc Set | Kitchenary Kart', '[] Hotel Wooden Tray Rubber Base No.48 3pc | Kitchenary Kart'],
    ],
  },
];

for (const doc of DOCS) {
  let text = readFileSync(doc.src, 'utf8').replace(/\r\n/g, '\n');
  // Metas are only replaced when over 160 — check first so a replacement
  // never fires on a meta that was already fine.
  for (const [from, to] of doc.replace) {
    if (!text.includes(from)) throw new Error(`${doc.src}: not found: ${from.slice(0, 90)}`);
    text = text.replace(from, to);
  }
  const labels = (text.match(/^\[b\] Suitable For:/gm) ?? []).length;
  if (labels !== doc.labels) throw new Error(`${doc.src}: expected ${doc.labels} labels, found ${labels}`);
  text = text.replace(/^\[b\] Suitable For:/gm, '[b] Suitable for:');
  if (/larger electric glass-washing machine|without requiring a large machine/.test(text)) throw new Error('comparison still present');

  const lines = text.split('\n');
  const titles = [];
  lines.forEach((l, i) => {
    const next = lines[i + 1]?.slice(3) ?? '';
    if (l === '[Heading2] SEO Title') {
      if (next.length > 60) throw new Error(`title ${next.length}: ${next}`);
      titles.push(next);
    }
    if (l === '[Heading2] Meta Description' && (next.length > 160 || !/[.!]$/.test(next))) throw new Error(`meta ${next.length}: ${next}`);
  });
  if (new Set(titles).size !== titles.length) throw new Error('duplicate title');
  writeFileSync(doc.out, text);
  console.log(doc.out);
  for (const t of titles) console.log(`  T${String(t.length).padStart(3)} ${t}`);
}
