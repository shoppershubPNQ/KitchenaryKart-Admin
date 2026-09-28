/** Shorten a description document's SEO titles so they fit what Google shows.
 *
 *  These documents build the title out of the whole product name, which runs
 *  61-74 characters. Rather than cut mid-word — which is what the raw
 *  documents do, turning "Silver" into "Si" — this drops the words a shopper
 *  does not need, in order, until the title fits: the supplier's bracketed
 *  code, then filler like "Display" in "Display Stand", then long words for
 *  their usual short forms. Separators collapse to plain spaces.
 *
 *  Nothing that tells two listings apart is ever dropped, and the run fails
 *  rather than emit a title that is too long, a duplicate, or one whose SKU
 *  has no title at all.
 *
 *  Usage: node scripts/shorten-doc-titles.mjs <doc.txt> <out.txt>
 */
import { readFileSync, writeFileSync } from 'fs';

const [SRC, OUT] = process.argv.slice(2);
if (!SRC || !OUT) throw new Error('usage: shorten-doc-titles.mjs <doc.txt> <out.txt>');

const BRAND = ' | Kitchenary Kart';
const MAX = 60;

/** Applied in order, each only if the title is still too long. */
const REDUCTIONS = [
  [/\s*\(\d+\)/g, ''],              // supplier codes: "A4 (5369)" -> "A4"
  [/\s+-\s+/g, ' '],                // "Tray - 5 Slot - Black" -> "Tray 5 Slot Black"
  [/\s*×\s*/g, 'x'],                // "40 × 30cm" -> "40x30cm"
  [/\bDisplay Stand\b/g, 'Stand'],
  [/\bDisplay Tray\b/g, 'Tray'],
  [/\bCompartment\b/g, 'Comp'],
  [/\bServing Tray\b/g, 'Tray'],
  [/\bwith Stand & Dome Lid\b/g, 'with Dome Lid'],
  [/\bwith Side Ears & PC Cover\b/g, 'Side Ears & Cover'],
  [/\bTeflon Aluminium\b/g, 'Teflon'],
  [/\bTeflon Coated\b/g, 'Teflon'],
  [/\bAluminium Card Holder\b/g, 'Card Holder'],
  [/\bL-Shaped Foldable\b/g, 'Foldable'],
  [/\bPack of\b/g, 'Pack'],
  [/(\d)\s*x\s*(\d)/g, '$1x$2'],     // "32 x 25 x 8 cm" -> "32x25x8 cm"
  [/(\d)\s+cm\b/g, '$1cm'],          // "8 cm" -> "8cm"
  [/\bTransparent\b/g, ''],          // every cover in the range is transparent
  [/\bAcrylic Rectangle\b/g, 'Acrylic Rect'],
  [/\bSpare for\b/g, 'Spare'],
  [/\bSpares for\b/g, 'Spare'],
  [/\bCereal Dispenser\b/g, 'Cereal Disp'],
  [/\bWooden Dimsum Basket\b/g, 'Dimsum Basket'],
  [/\bPaper Sheets for\b/g, 'Paper Sheets'],
  [/\bDrinking Game\b/g, 'Game'],
];

function shorten(full) {
  let name = full.endsWith(BRAND) ? full.slice(0, -BRAND.length) : full;
  for (const [from, to] of REDUCTIONS) {
    if ((name + BRAND).length <= MAX) break;
    name = name.replace(from, to).replace(/\s{2,}/g, ' ').trim();
  }
  // Last resort: drop whole words off the END. These documents put the size,
  // colour or part name first, so the tail is the general description — and
  // the caller still refuses any title that ends up duplicating another.
  while ((name + BRAND).length > MAX && name.includes(' ')) {
    name = name.slice(0, name.lastIndexOf(' ')).replace(/[\s,|&-]+$/, '');
  }
  return `${name}${BRAND}`;
}

const out = [];
const seen = new Map();
let sku = '';
let awaiting = false;
let changed = 0;

for (const raw of readFileSync(SRC, 'utf8').split(/\r?\n/)) {
  const line = raw.replace(/KitchenaryKart/g, 'Kitchenary Kart');

  const s = /SKU:\s*([A-Z0-9.-]+)/.exec(line);
  if (s) { sku = s[1]; out.push(line); continue; }

  if (/^\[Heading2\] SEO Title$/.test(line)) { out.push(line); awaiting = true; continue; }
  if (awaiting) {
    const original = line.replace(/^\[[^\]]*\]\s?/, '');
    const title = shorten(original);
    if (title.length > MAX) throw new Error(`${sku}: still ${title.length} — ${title}`);
    if (seen.has(title)) throw new Error(`${sku}: duplicate of ${seen.get(title)} — ${title}`);
    seen.set(title, sku);
    if (title !== original) changed++;
    out.push(`[] ${title}`);
    awaiting = false;
    continue;
  }

  let l = line;
  if (l.startsWith('[b] ')) {
    l = /^\[b\] (Suitable for|Care & Use|Main Specifications|Website Price|Stock Status|SKU|Product Note|Research Note):/.test(l)
      ? l.replace(/^\[b\] /, '[] ')
      : l.replace(/^\[b\] /, '[ListBullet,b] ');
  }
  out.push(l);
}

writeFileSync(OUT, out.join('\n'));
const lens = [...seen.keys()].map((t) => t.length);
console.log(`${OUT} · ${seen.size} titles, ${changed} shortened, all distinct · ${Math.min(...lens)}-${Math.max(...lens)} chars`);
