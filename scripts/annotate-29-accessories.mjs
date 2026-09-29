/** Corrected copy of the owner's 29-product document (29 Sep 2026): cream whippers,
 *  cast iron / Teflon pans, BBQ accessories.
 *
 *  No product fact differs from the listing. The size comparisons in the copy
 *  (500ml vs 1000ml, Size 6 vs 8, 7 vs 12 slots, Small vs Big) are between sizes
 *  of the SAME listing and stay. Editorial fixes:
 *  - All 29 metas were one template ending "Product-specific design for compatible
 *    applications." — 26 of them over 160. Rewritten per product group.
 *  - 10 titles over 60 shortened; "Cast Iron Pan — 6" reads "Cast Iron Pan Size 6".
 *
 *  Usage: node scripts/annotate-29-accessories.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const SRC = 'scripts/docs/Kitchenary_Kart_29_Products_Reference_Style_Updated.txt';
const OUT = 'scripts/docs/accessories-29-annotated.txt';
const BRAND = ' | Kitchenary Kart';

const TITLES = {
  'KKA0029-CIP6': 'Cast Iron Pan Size 6',
  'KKA0030-CIP8': 'Cast Iron Pan Size 8',
  'KKA0031-CIP10': 'Cast Iron Pan Size 10',
  'KKA0035-TFP': 'Non Stick Smiley Face Omelette Pan',
  'KKA0036-TPPCE10': 'Teflon Pizza Pan, Removable Bottom 10cm',
  'KKA0037-TPPCE20': 'Teflon Pizza Pan, Removable Bottom 20cm',
  'KKA0038-TPPCE24': 'Teflon Pizza Pan, Removable Bottom 24cm',
  'KKA0004-BBQSMBR': 'BBQ Grill Scraper & Marinating Brush Set',
  'KKA0007-BBQTBR': 'BBQ Grill Triangle 2 Sided Brush 36cm',
  'KKA0006-BBQYBR': 'BBQ Grill Y Shaped Roller Brush 30cm',
  'KKA0012-BBQOVN': 'Oval BBQ Grill Net with Wooden Handle',
  'KKA0015-BBQCN': 'Corn BBQ Grill Net with Wooden Handle',
  'KKA0013-BBQRENS': 'Small Rectangle BBQ Grill Net with Handle',
  'KKA0014-BBQRENB': 'Big Rectangle BBQ Grill Net with Handle',
};


/**
 * Owner, 29 Sep: "repeat words dont use". The document leaned on filler — "compatible"
 * ×86, "suitable" ×73, "dedicated" ×35 across 29 products — and gave 11-12 products
 * the same Suitable-for and Care & Use lines, some of them wrong for the product
 * (skewers told to "inspect brushes", cast iron pans given coated-pan advice).
 * Filler adjectives come out of the description text (not Care & Use, where
 * "compatible chargers" is a safety point); each product gets its own
 * Suitable-for line and a Care & Use line for its material.
 */
const FILLER = [
  [/\b[Ss]uitable (?!for\b)/g, ''],
  [/\bcompatible (?!with\b)/g, ''],
  [/\bdedicated /g, ''],
  [/ according to the (product|accessory) design/g, ''],
  [/ as applicable/g, ''],
  // Varied rather than removed: "useful" ×46 and "provides" ×35 read as a template.
  [/\bis useful when\b/g, 'helps when'],
  [/\bis useful for\b/g, 'works well for'],
  [/\ba useful addition\b/g, 'a handy addition'],
  [/^Useful for /, 'Good for '],
  [/^Useful when /, 'Handy when '],
  [/^Useful where /, 'Handy where '],
  // "format" ×48: say what is meant where a plainer word fits.
  [/\b(compact|larger|smaller|bigger) format\b/gi, '$1 size'],
  [/\b(oval|round|rectangular|rectangle|curved|two-sided|triangle|Y-shaped|traditional pan) format\b/gi, '$1 shape'],
  [/\b(\d+x\d+cm) MS format\b/g, '$1 MS net'],
];
const CARE_CAST = 'Wash after use, dry thoroughly and maintain the cast iron surface as recommended. Handle with care when hot.';
const CARE_COATED = 'Avoid sharp utensils and abrasive scrubbers, and let the pan cool before cleaning.';
const CARE_BRUSH = 'Let the grill cool before cleaning, rinse and dry the brush after use, and stop using it if it is damaged.';
const CARE_METAL = 'Let the metal cool before cleaning, wash after use and dry thoroughly before storage.';
const SUITABLE = {
  'KKA0029-CIP6': ['Individual portions and small pan-cooked dishes in restaurants, cafés and hotels.', CARE_CAST],
  'KKA0030-CIP8': ['Everyday pan-cooked dishes and sharing portions in restaurant and café kitchens.', CARE_CAST],
  'KKA0031-CIP10': ['Larger pan-cooked batches and family-style servings in hotel and restaurant kitchens.', CARE_CAST],
  'KKA0032-CIP8S': ['Pizza-style and baked dishes portioned into eight sections.', CARE_CAST],
  'KKA0033-CIP7S': ['Appe, paniyaram and mini idli in smaller batches.', CARE_CAST],
  'KKA0034-CIP12S': ['Appe, paniyaram and mini idli in bigger batches for busy service.', CARE_CAST],
  'KKA0035-TFP': ['Eggs, omelettes and breakfast servings in cafés and home kitchens.', CARE_COATED],
  'KKA0036-TPPCE10': ['Individual pizzas and small bakes.', CARE_COATED],
  'KKA0037-TPPCE20': ['Medium pizzas, tarts and baked items.', CARE_COATED],
  'KKA0038-TPPCE24': ['Larger pizzas and baked items for sharing.', CARE_COATED],
  'KKA0039-TRPWH': ['Quick pan-cooked dishes in cafés and home kitchens.', CARE_COATED],
  'KKA0004-BBQSMBR': ['Scraping grill grates and basting food at barbecue stations.', CARE_BRUSH],
  'KKA0005-BBQCBR': ['Cleaning wide grill grates on larger barbecue setups.', CARE_BRUSH],
  'KKA0007-BBQTBR': ['Cleaning grill grates and corners with a two-sided head.', CARE_BRUSH],
  'KKA0006-BBQYBR': ['Cleaning grill bars on compact barbecue setups.', CARE_BRUSH],
  'KKA0008-BBQRERS': ['Grilling small batches on barbecue grills.', CARE_METAL],
  'KKA0009-BBQRERB': ['Grilling larger batches on barbecue grills.', CARE_METAL],
  'KKA0010-MSBBQSK': ['Kebabs and tikka on barbecue grills and tandoor setups.', CARE_METAL],
  'KKA0011-SSBBQSK': ['Reusable skewering for kebabs, tikka and grilled vegetables.', CARE_METAL],
  'KKA0012-BBQOVN': ['Grilling smaller pieces that could slip through grill bars.', CARE_METAL],
  'KKA0015-BBQCN': ['Grilling corn on the cob over a barbecue.', CARE_METAL],
  'KKA0013-BBQRENS': ['Grilling a small batch held together in one net.', CARE_METAL],
  'KKA0014-BBQRENB': ['Grilling a large batch held together in one net.', CARE_METAL],
};
/** Every meta written for its product — no shared endings. */
const METAS = {
  'KKA0057-CWH500': 'Shop the Kitchenary Kart Aluminium Cream Whipper Heavy, 500ml — for fresh whipped cream on desserts and coffee in cafés and bakeries.',
  'KKA0058-CWH1000': 'Buy the Kitchenary Kart Aluminium Cream Whipper Heavy, 1000ml. Bigger batches of whipped cream with fewer refills for busy dessert counters.',
  'KKA0059-CWL500': 'Kitchenary Kart Aluminium Cream Whipper Lite, 500ml: a lighter whipper for small whipped-cream batches on shakes, cakes and desserts.',
  'KKA0060-CWL1000': 'Order the Kitchenary Kart Aluminium Cream Whipper Lite, 1000ml for larger whipped-cream batches at beverage and dessert stations.',
  'KKA0061-CWB500': 'Kitchenary Kart Premium Black Cream Whipper, 500ml — a sleek whipper for topping desserts and drinks at café and bakery counters.',
  'KKA0062-CWB1000': 'Shop the Kitchenary Kart Premium Black Cream Whipper, 1000ml, holding enough whipped cream for high-volume dessert and beverage service.',
  'KKA0029-CIP6': 'Kitchenary Kart Cast Iron Pan, Size 6: a compact cast iron pan for single portions and small dishes in restaurants and cafés.',
  'KKA0030-CIP8': 'Buy the Kitchenary Kart Cast Iron Pan, Size 8 — more cooking area for sharing portions in restaurant, café and hotel kitchens.',
  'KKA0031-CIP10': 'Shop the Kitchenary Kart Cast Iron Pan, Size 10, the largest in the set, for family-style servings and bigger pan-cooked batches.',
  'KKA0032-CIP8S': 'Kitchenary Kart Cast Iron Pan with 8 pizza-type slices: bake and serve eight neat portions from one heavy cast iron pan.',
  'KKA0033-CIP7S': 'Make appe, paniyaram and mini idli with the Kitchenary Kart 7-slot cast iron pan, sized for small batches in cafés and homes.',
  'KKA0034-CIP12S': 'Kitchenary Kart 12-slot cast iron appe and mini idli pan — twelve pieces per batch for busy breakfast service.',
  'KKA0035-TFP': 'Shop the Kitchenary Kart non-stick Smiley Face omelette pan, a Teflon-coated pan that turns eggs and breakfasts into fun shapes.',
  'KKA0036-TPPCE10': 'Kitchenary Kart 10cm Teflon pizza pan with curvy edges and a removable bottom, sized for individual pizzas and small bakes.',
  'KKA0037-TPPCE20': 'Buy the Kitchenary Kart 20cm Teflon pizza pan: curvy edges and a removable bottom make medium pizzas and tarts easy to release.',
  'KKA0038-TPPCE24': 'Kitchenary Kart 24cm Teflon pizza pan with a removable bottom and curvy edges, for larger pizzas and sharing bakes.',
  'KKA0039-TRPWH': 'Shop the Kitchenary Kart Teflon Round Pan with Handle — a non-stick pan for quick cooking in cafés and home kitchens.',
  'KKA0004-BBQSMBR': 'Kitchenary Kart BBQ set: a 9" grill scraper brush with a 7" marinating brush for cleaning grates and basting food.',
  'KKA0005-BBQCBR': 'Shop the Kitchenary Kart black curved BBQ grill brush, 47cm, with long reach for cleaning wide grill grates.',
  'KKA0007-BBQTBR': 'Kitchenary Kart triangle 2-sided BBQ grill brush, 36cm — two cleaning faces for grates and corners.',
  'KKA0006-BBQYBR': 'Buy the Kitchenary Kart Y-shaped roller BBQ grill brush, 30cm, a compact brush for cleaning grill bars.',
  'KKA0008-BBQRERS': 'Kitchenary Kart MS BBQ grill rectangle rack, small, for grilling smaller batches on barbecue grills.',
  'KKA0009-BBQRERB': 'Shop the Kitchenary Kart MS rectangle BBQ grill rack, big, with more grilling area for larger batches.',
  'KKA0010-MSBBQSK': 'Kitchenary Kart 16" MS BBQ skewers with wooden handles for kebabs and tikka on barbecue grills.',
  'KKA0011-SSBBQSK': 'Buy Kitchenary Kart 16" stainless steel BBQ skewers — reusable sticks for kebabs, tikka and grilled vegetables.',
  'KKA0012-BBQOVN': 'Kitchenary Kart oval MS BBQ grill net, 38x14cm, with a wooden handle to hold small pieces together while grilling.',
  'KKA0015-BBQCN': 'Shop the Kitchenary Kart corn-shaped MS BBQ grill net with a wooden handle for grilling corn on the cob.',
  'KKA0013-BBQRENS': 'Kitchenary Kart small rectangle MS BBQ grill net with a wooden handle for grilling a batch in one go.',
  'KKA0014-BBQRENB': 'Buy the Kitchenary Kart big rectangle MS BBQ grill net with a wooden handle for grilling larger batches together.',
};

const lines = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n').split('\n');
let inBodyFix = false;
let skuFix = '';
for (let i = 0; i < lines.length; i++) {
  const m = /^\[[^\]]*\] SKU:\s*(\S+)/.exec(lines[i]);
  if (m) skuFix = m[1];
  if (lines[i] === '[Heading2] Product Description') { inBodyFix = true; continue; }
  if (lines[i] === '[Heading2] SEO Title') { inBodyFix = false; continue; }
  if (!inBodyFix || lines[i].startsWith('[Heading')) continue;
  const tag = /^\[[^\]]*\]\s?/.exec(lines[i])?.[0] ?? '';
  let t = lines[i].slice(tag.length);
  if (t.startsWith('Suitable for:') && SUITABLE[skuFix]) { lines[i] = `${tag}Suitable for: ${SUITABLE[skuFix][0]}`; continue; }
  if (t.startsWith('Care & Use:')) {
    if (SUITABLE[skuFix]) lines[i] = `${tag}Care & Use: ${SUITABLE[skuFix][1]}`;
    else lines[i] = `${tag}${t.replace(/ as applicable/g, '')}`;
    continue;
  }
  // Label ("Wooden Handle: …") stays as is; filler comes out of the text after it.
  const lab = /^([^:]{2,60}:\s)/.exec(t)?.[1] ?? '';
  let body = t.slice(lab.length);
  for (const [re, to] of FILLER) body = body.replace(re, to);
  body = body.replace(/\b([Aa]) ([aeio])/g, (x, a, v) => `${a}n ${v}`).replace(/\s{2,}/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  lines[i] = `${tag}${lab}${body}`;
}
let sku = '';
const titles = new Map();
let nt = 0, nm = 0;
for (let i = 0; i < lines.length; i++) {
  const m = /^\[[^\]]*\] SKU:\s*(\S+)/.exec(lines[i]);
  if (m) sku = m[1];
  if (lines[i] === '[Heading2] SEO Title') {
    if (TITLES[sku]) { lines[i + 1] = `[] ${TITLES[sku]}${BRAND}`; nt++; }
    const t = lines[i + 1].slice(3);
    if (t.length > 60) throw new Error(`${sku}: title ${t.length} — ${t}`);
    if (titles.has(t)) throw new Error(`${sku}: duplicate title`);
    titles.set(t, sku);
  }
  if (lines[i] === '[Heading2] Meta Description') {
    const meta = METAS[sku];
    if (!meta) throw new Error(`no meta for ${sku}`);
    if (meta.length > 160) throw new Error(`${sku}: meta ${meta.length} — ${meta}`);
    lines[i + 1] = `[] ${meta}`; nm++;
  }
}
const text = lines.join('\n');
if (text.includes('Product-specific design for compatible applications')) throw new Error('filler left');
if (nm !== 29 || titles.size !== 29) throw new Error(`counts: ${nm} metas, ${titles.size} titles`);
writeFileSync(OUT, text);
console.log(`${OUT} · ${nt} titles rewritten · ${nm} metas rewritten · 29 titles unique`);
