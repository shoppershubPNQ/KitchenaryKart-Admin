/** Corrected copies of the owner's two polyrattan basket documents (29 Sep 2026):
 *  HEAVY (105 SKUs) and LITE (12 SKUs).
 *
 *  check-doc-vs-listing found no product fact that differs from the listing (the one
 *  hit, a "transparent" acrylic lid, is what the product's own photo calls it:
 *  "Crystal clear acrylic lid"). Editorial fixes only:
 *  - The documents were written from the short link-list labels ("Heavy Oval
 *    23x11x8cm — Walnut Brown"), so all 105 HEAVY bodies named the product by that
 *    label and no HEAVY title said "Basket" or "Polyrattan". Bodies now use the
 *    listing's real name; titles and metas are rebuilt in one pattern.
 *  - Repeated bullets inside a section are dropped ("Hospitality Use" twice).
 *  - "a lighter basket is preferred" (12 LITE) and "a more substantial basket"
 *    (1 HEAVY) set the two series against each other — reworded.
 *
 *  Usage: npx tsx scripts/annotate-polyrattan-117.ts [--write]
 */
import { readFileSync, writeFileSync } from 'fs';
import { prisma } from '../lib/db';

const WRITE = process.argv.includes('--write');
const DOCS = [
  { src: 'scripts/docs/Kitchenary_Kart_LITE_Basket_All_12_Updated_Reference_Style.txt', out: 'scripts/docs/polyrattan-lite-12-annotated.txt' },
  { src: 'scripts/docs/Kitchenary_Kart_HEAVY_Basket_All_105_Product_Descriptions.txt', out: 'scripts/docs/polyrattan-heavy-105-annotated.txt' },
];
const BRAND = ' | Kitchenary Kart';
const SHAPES = 'Boat Platter|Square Platter|Long Rectangle|Long Oval|L-Shaped|Rectangle|Round|Oval|Square|Boat|Heart|Cylindrical';
const SHORT: Array<[RegExp, string]> = [
  [/with PC Roll Top Lid/, 'Roll Top Lid'], [/with Acrylic Lid/, 'Acrylic Lid'], [/with Flower Edges/, 'Flower Edge'],
  [/with Heart Handles/, 'Heart Handle'], [/with (\d) Compartments/, '$1 Compartment'], [/\(1\/1 Full Size\)/, 'Full Size'],
  [/\(1\/2 Half Size\)/, 'Half Size'], [/with Base Stand/, 'with Stand'], [/2 Layer with Handle/, '2 Layer'],
  [/with Handles/, 'Handled'], [/with Handle/, 'Handled'],
];

/** Hand-written titles where no generated form fits 60 (keyed by section label). */
const OVERRIDE: Record<string, string> = {
  'AD3 Heavy Round with 5 Compartments 37x6.5cm - Walnut Brown': 'Heavy Round 5-Compartment Basket 37x6.5cm',
  'Heavy Boat Platter - Walnut Brown — Big No.9': 'Heavy Boat Platter Basket Big No.9',
  'Heavy Boat Platter - Walnut Brown — Small No.10': 'Heavy Boat Platter Basket Small No.10',
  'Heavy Boat - Walnut Brown — Big 1016': 'Heavy Boat Basket Big 1016',
  'Heavy Boat - Walnut Brown — Small 1078A': 'Heavy Boat Basket Small 1078A',
  'Heavy Boat - Walnut Brown — Medium 1078B': 'Heavy Boat Basket Medium 1078B',
  'Heavy Oval with Handle - Walnut Brown — Big 2082A': 'Heavy Oval Handled Basket Big 2082A',
  'Heavy Cylindrical Laundry Basket with Handles 40x27x46cm — Walnut Brown': 'Polyrattan Laundry Basket Walnut Brown',
  'Heavy Cylindrical Laundry Basket with Handles 40x27x46cm — Dark Brown': 'Polyrattan Laundry Basket Dark Brown',
  'Heavy L-Shaped Utility Holder - Walnut Brown — Small No.26': 'L-Shaped Polyrattan Utility Holder No.26',
  'Heavy L-Shaped Utility Holder - Walnut Brown — Big No.27': 'L-Shaped Polyrattan Utility Holder No.27',
  'Heavy Oval with Flower Edges 24x20x8cm — Walnut Brown': 'Oval Flower Edge Basket, Walnut Brown',
  'Heavy Oval with Flower Edges 24x20x8cm — Double Colour': 'Oval Flower Edge Basket, Double Colour',
  'Heavy Oval with Handle - Walnut Brown — Small No.17': 'Heavy Oval Handled Basket Small No.17',
  'Heavy Rectangle (1/1 Full Size) 53x32x8cm — Walnut Brown': 'Full Size Polyrattan Basket, Walnut Brown',
  'Heavy Rectangle (1/1 Full Size) 53x32x8cm — Cream': 'Full Size Polyrattan Basket, Cream',
  'Heavy Rectangle with 4 Compartments 32x24x8cm - Walnut Brown': 'Heavy Rectangle 4-Compartment Basket',
  'Heavy Rectangle with Acrylic Lid 32x25x8cm - Walnut Brown': 'Heavy Rectangle Basket with Acrylic Lid',
  'Heavy Rectangle with Flower Edges 30x21.6x6.5cm — Walnut Brown': 'Rectangle Flower Basket, Walnut Brown',
  'Heavy Rectangle with Flower Edges 30x21.6x6.5cm — Double Colour': 'Rectangle Flower Basket, Double Colour',
  'Heavy Rectangle with Heart Handles - Walnut Brown — Big No.1': 'Heart Handle Rectangle Basket Big No.1',
  'Heavy Rectangle with Heart Handles - Walnut Brown — Small No.2': 'Heart Handle Rectangle Basket Small No.2',
  'Heavy Rectangle with PC Roll Top Lid (1/1 Full Size) 53x32x8cm — Walnut Brown': 'Roll Top Basket Full Size, Walnut Brown',
  'Heavy Rectangle with PC Roll Top Lid (1/1 Full Size) 53x32x8cm — Cream': 'Roll Top Basket Full Size, Cream',
  'Heavy Round with Base Stand - Walnut Brown — Small No.36': 'Heavy Round Basket with Stand Small No.36',
  'Heavy Round with Base Stand - Walnut Brown — Big No.37': 'Heavy Round Basket with Stand Big No.37',
  'Heavy Round with Flower Edges 16x7cm — Walnut Brown': 'Round Flower Basket 16x7cm Walnut Brown',
  'Heavy Round with Flower Edges 16x7cm — Double Colour': 'Round Flower Basket 16x7cm Double Colour',
  'Heavy Round with Flower Edges 20x7cm — Walnut Brown': 'Round Flower Basket 20x7cm Walnut Brown',
  'Heavy Round with Flower Edges 20x7cm — Double Colour': 'Round Flower Basket 20x7cm Double Colour',
  'Heavy Round with Flower Edges 25x7cm — Walnut Brown': 'Round Flower Basket 25x7cm Walnut Brown',
  'Heavy Round with Flower Edges 25x7cm — Double Colour': 'Round Flower Basket 25x7cm Double Colour',
  'Heavy Round with Handles 20x8cm — Walnut Brown No.5': 'Round Handled Basket 20x8cm Walnut Brown',
  'Heavy Round with Handles 20x8cm — Double Colour No.6': 'Round Handled Basket 20x8cm Double Colour',
  'Heavy Round with PC Roll Top Lid 40x10cm — Walnut Brown': 'Round Roll Top Basket 40x10cm Walnut Brown',
  'Heavy Round with PC Roll Top Lid 40x10cm — Cream': 'Round Roll Top Basket 40x10cm Cream',
  'Heavy Square Platter - Walnut Brown — Small No.18': 'Heavy Square Platter Basket Small No.18',
  'Heavy Square Platter - Walnut Brown — Big No.19': 'Heavy Square Platter Basket Big No.19',
  'No.11 Heavy Rectangle with Handles 23x17x10cm - Walnut Brown': 'No.11 Heavy Rectangle Handled Basket',
  'No.21 Heavy Rectangle 2 Layer with Handle 31x21x39cm - Walnut Brown': 'No.21 Heavy Rectangle 2 Layer Basket',
  'No.24 Heavy Rectangle Utility Holder 31.5x12x14.5cm - Walnut Brown': 'No.24 Rectangle Polyrattan Utility Holder',
};
const UNFIT: string[] = [];

function clean(label: string) {
  return label.replace(/\s+[—-]\s+/g, ' ').replace(/\((\d{4}[A-Z]?)\)/, '$1').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Title candidates for a label, most complete first. A shortened form is only
 * accepted when no OTHER label can produce the same string (see pickTitles), so
 * dropping the colour or the size can never make two listings share a title.
 */
function titleCandidates(label: string): string[] {
  const s = clean(label);
  const m = new RegExp(`^((?:No\\.\\d+|AD3) )?(Super Heavy|Heavy|Lite) (${SHAPES})(.*)$`).exec(s);
  if (!m) throw new Error(`cannot parse label: ${label}`);
  const [, pre = '', series, shape] = m;
  let rest = m[4].trim();
  let noun = 'Polyrattan Basket';
  if (/^Laundry Basket\b/.test(rest)) { noun = 'Polyrattan Laundry Basket'; rest = rest.replace(/^Laundry Basket\s*/, ''); }
  if (/\bUtility Holder\b/.test(rest)) { noun = 'Polyrattan Utility Holder'; rest = rest.replace(/\s*Utility Holder\s*/, ' ').trim(); }
  let short = rest;
  for (const [re, to] of SHORT) short = short.replace(re, to);
  short = short.replace(/\s{2,}/g, ' ').trim();
  const noDims = short.replace(/\s*\d+(?:\.\d+)?x\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)?cm/, '').trim();
  const noColour = short.replace(/\s*(Walnut Brown|Double Colour|Dark Brown|Cream)$/, '').trim();
  const bare = noun.replace('Polyrattan ', '');
  const join = (...xs: string[]) => xs.filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim();
  return [...new Set([
    join(pre + series, shape, noun, rest),
    join(pre + series, shape, noun, short),
    join(pre + series, shape, bare, short),
    join(pre + shape, bare, short),
    join(pre + series, shape, noun, noDims),
    join(pre + series, shape, bare, noDims),
    join(pre + series, shape, noun, noColour),
    join(pre + series, shape, bare, noColour),
  ])];
}

const PICKED = new Map<string, string>();
function pickTitles(labels: string[]) {
  const owners = new Map<string, Set<string>>();
  const cands = new Map(labels.map((l) => [l, titleCandidates(l)]));
  for (const [l, cs] of cands) for (const c of cs) { if (!owners.has(c)) owners.set(c, new Set()); owners.get(c)!.add(l); }
  const ok = (c: string | undefined) => !!c && (c + BRAND).length <= 60 && owners.get(c)!.size === 1;
  // Colour siblings (same label bar the colour) take the SAME pattern, so a Walnut
  // Brown / Double Colour pair never reads "Heavy Oval…" next to "Oval…".
  const groups = new Map<string, string[]>();
  for (const l of labels) {
    const key = clean(l).replace(/\b(Walnut Brown|Double Colour|Dark Brown|Cream)\b/g, '').replace(/\s{2,}/g, ' ').trim();
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  for (const members of groups.values()) {
    const free = members.filter((l) => !OVERRIDE[l]);
    const n = Math.max(0, ...free.map((l) => cands.get(l)!.length));
    const k = [...Array(n).keys()].find((i) => free.every((l) => ok(cands.get(l)![i])));
    for (const l of members) {
      const t = OVERRIDE[l] ?? (k !== undefined ? cands.get(l)![k] : cands.get(l)!.find(ok));
      if (t) PICKED.set(l, t); else UNFIT.push(`${l}  →  shortest unique-free: ${cands.get(l)!.at(-1)}`);
    }
  }
}

/** Title (without brand) and meta name, built from the section label. */
function seoParts(label: string) {
  const cs = titleCandidates(label);
  return { title: PICKED.get(label) ?? `UNFIT ${label}`, names: cs };
}

function metaFor(names: string[]) {
  const tails = [
    ' for serving, display and organisation in restaurants, hotels, cafés and buffet setups.',
    ' for serving and display in restaurants, hotels, cafés and buffets.',
    ' for serving and display in restaurants, hotels and cafés.',
  ];
  for (const name of names) for (const t of tails) {
    const m = `Shop the Kitchenary Kart ${name}${t}`;
    if (m.length <= 160) return m;
  }
  throw new Error(`no meta fits for ${names[0]}`);
}

function variantLabel(v: string | null) {
  if (!v) return '';
  try { const o = JSON.parse(v); return o.Size ?? o.Color ?? v; } catch { return v; }
}

(async () => {
  // Titles are chosen over BOTH documents at once, so uniqueness spans all 117.
  pickTitles(DOCS.flatMap((d) => readFileSync(d.src, 'utf8').split(/\r?\n/)
    .filter((l) => l.startsWith('[Heading1]')).map((l) => l.replace(/^\[Heading1\] \d+\.\s*/, ''))));
  const allTitles = new Map<string, string>();
  for (const doc of DOCS) {
    const lines = readFileSync(doc.src, 'utf8').replace(/\r\n/g, '\n').split('\n');
    const skus = lines.filter((l) => l.startsWith('[b] SKU:')).map((l) => l.replace('[b] SKU:', '').trim());
    const vs = await prisma.productVariant.findMany({ where: { skuSuffix: { in: skus } }, select: { skuSuffix: true, variantValue: true, product: { select: { name: true } } } });
    const ps = await prisma.product.findMany({ where: { sku: { in: skus } }, select: { sku: true, name: true, _count: { select: { variants: true } } } });
    const realName = (sku: string) => {
      const v = vs.find((x) => x.skuSuffix === sku);
      if (v) return `${v.product.name} — ${variantLabel(v.variantValue)}`;
      const p = ps.find((x) => x.sku === sku);
      if (!p) throw new Error(`${sku} not in catalogue`);
      return p.name;
    };

    const out: string[] = [];
    let label = '', sku = '', inBody = false, seen = new Set<string>();
    const done = { name: 0, dupe: 0, compare: 0, title: 0, meta: 0 };
    for (let i = 0; i < lines.length; i++) {
      let l = lines[i];
      if (l.startsWith('[Heading1]')) { label = l.replace(/^\[Heading1\] \d+\.\s*/, ''); seen = new Set(); }
      if (l.startsWith('[b] SKU:')) sku = l.replace('[b] SKU:', '').trim();
      if (l === '[Heading2] Product Description') inBody = true;
      if (l === '[Heading2] SEO Title') inBody = false;

      if (inBody && !l.startsWith('[Heading')) {
        if (l.includes(`Kitchenary Kart ${label}`)) { l = l.split(`Kitchenary Kart ${label}`).join(`Kitchenary Kart ${realName(sku)}`); done.name++; }
        const before = l;
        l = l.replace('A practical option where a lighter basket is preferred for regular serving and display use.', 'A lightweight basket for regular serving and display use.')
             .replace('that want a more substantial basket for routine serving and display.', 'that want a substantial basket for routine serving and display.');
        if (l !== before) done.compare++;
        if (l.startsWith('[ListBullet')) { if (seen.has(l)) { done.dupe++; continue; } seen.add(l); }
      }
      if (l === '[Heading2] SEO Title') {
        const { title } = seoParts(label);
        if ((title + BRAND).length > 60) throw new Error(`${sku}: title over 60 — ${title}`);
        if (allTitles.has(title)) throw new Error(`${sku}: duplicate title of ${allTitles.get(title)} — ${title}`);
        allTitles.set(title, sku);
        out.push(l, `[] ${title}${BRAND}`); i++; done.title++; continue;
      }
      if (l === '[Heading2] Meta Description') {
        const { names } = seoParts(label);
        out.push(l, `[] ${metaFor(names)}`); i++; done.meta++; continue;
      }
      out.push(l);
    }
    const text = out.join('\n');
    if (/lighter basket is preferred|more substantial basket/.test(text)) throw new Error('comparison left');
    console.log(`${doc.out}: ${JSON.stringify(done)}`);
    if (WRITE) writeFileSync(doc.out, text);
  }
  if (UNFIT.length) { console.log(`\n${UNFIT.length} label(s) need a hand-written title:\n  ${UNFIT.join('\n  ')}`); await prisma.$disconnect(); process.exit(1); }
  console.log(`${allTitles.size} titles, all unique and <= 60`);
  if (!WRITE) for (const [t, s] of allTitles) console.log(`  ${String((t + BRAND).length).padStart(2)} ${s.padEnd(22)} ${t}`);
  await prisma.$disconnect();
})();
