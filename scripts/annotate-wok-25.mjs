/** Wok & pan descriptions (25), rewritten from the owner's document (30 Sep 2026).
 *
 *  The document was one template filled 25 times: three bullets and the
 *  Suitable-for line identical on all 25 ("Provides a clearly defined cooking
 *  size for selecting the right variant…", "Useful for suitable stir-frying…"),
 *  "suitable" ×100, "construction" ×90, and slips such as "With stainless steel
 *  construction and full ss construction". Owner rule: no repeated words.
 *
 *  Facts are the document's and the listing's only — material, handle, size,
 *  and the uses the document names (stir-fry, noodles, vegetables, sautéing).
 *  Material and handle lines are shared within a family (they are the same
 *  product in other sizes); every product has its own lead, use, size line,
 *  Suitable-for and meta. No comparison with any other listing.
 *
 *  Usage: node scripts/annotate-wok-25.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const SRC = 'scripts/docs/Kitchenary_Kart_Wok_All_25_Reference_Style_Product_Descriptions.txt';
const OUT = 'scripts/docs/wok-25-annotated.txt';
const BRAND = ' | Kitchenary Kart';

/** Care by material. Iron and mild steel rust if left wet; stainless does not
 *  need oiling; wood and rubber are kept away from soaking and flame. */
const FAMILY = {
  rubber: {
    p1: (n, u) => `The Kitchenary Kart ${n} is made for ${u}.`,
    p2: () => 'The black handle carries an ultra heavy rubber sleeve for a firm hold while tossing, and the metal bowl takes the high heat of a busy wok station.',
    bullets: ['Metal Wok Body: Built for regular high-heat stir-frying.', 'Rubber Grip Handle: Stays steady in the hand through long service.'],
    care: 'Let the wok cool before washing, dry it straight after cleaning and keep the surface lightly oiled to prevent rust. Keep the rubber away from open flame.',
  },
  fullss: {
    p1: (n, u) => `The Kitchenary Kart ${n} handles ${u}.`,
    p2: () => 'Bowl and handle are both stainless steel, so the whole wok is one piece with no wooden or rubber parts to wear out.',
    bullets: ['All Stainless Steel: One piece from the rim to the end of the handle.', 'Easy Cleaning: A smooth surface that washes clean between batches.'],
    care: 'Let the wok cool, wash with a non-abrasive scrubber and dry after use. The steel handle gets hot during cooking — hold it with a cloth.',
  },
  side: {
    p1: (n, u) => `The Kitchenary Kart ${n} takes on ${u}.`,
    p2: () => 'Two side handles let a full wok be lifted and positioned with both hands, and the iron bowl takes the high heat that bulk cooking needs.',
    bullets: ['Iron Body: Holds up to high heat when cooking large quantities.', 'Side Handles: A pair of loops for lifting a full wok with both hands.'],
    care: 'Wash, dry straight away and wipe on a light coat of oil to keep the iron seasoned and rust-free. The side handles heat up with the bowl — lift with cloths or mitts.',
  },
  ironpan: {
    p1: (n, u) => `The Kitchenary Kart ${n} covers ${u}.`,
    p2: () => 'The iron body copes with everyday high-heat cooking, and the wooden handle gives a comfortable hold for tossing and pouring.',
    bullets: ['Iron Pan Body: Takes regular high-heat pan cooking.', 'Wooden Handle: Comfortable to hold while tossing and pouring.'],
    care: 'Wash, dry straight away and wipe a thin film of oil over the iron so it stays seasoned. Keep the wooden handle away from the flame and out of long soaks.',
  },
  ironwok: {
    p1: (n, u) => `The Kitchenary Kart ${n} is built for ${u}.`,
    p2: () => 'An iron bowl takes the heat that proper wok cooking needs, and the wooden handle keeps a firm hold in the hand while tossing.',
    bullets: ['Iron Wok Body: Made for high-heat stir-frying and tossing.', 'Wooden Handle: A firm hold at the stove.'],
    care: 'Iron rusts if left wet — dry the wok on a low flame after washing and rub in a little oil before storing. Do not soak the wooden handle.',
  },
  mswok: {
    p1: (n, u) => `The Kitchenary Kart ${n} is a practical pick for ${u}.`,
    p2: () => 'The mild steel bowl suits everyday high-heat stir-frying, and the wooden handle gives a steady hold at the stove.',
    bullets: ['Mild Steel Body: An MS bowl for regular high-heat wok cooking.', 'Wooden Handle: Steady to hold through busy service.'],
    care: 'Mild steel needs to be dried fully after washing and kept lightly oiled between uses to stop rust. Keep the handle clear of the flame.',
  },
  woodss: {
    p1: (n, u) => `The Kitchenary Kart ${n} is sized for ${u}.`,
    p2: () => 'Stainless steel is quick to wash between batches, and the wood gives a surer hold while tossing.',
    bullets: ['Stainless Steel Bowl: Quick to wash and dry after service.', 'Wooden Handle: Comfortable for tossing and lifting.'],
    care: 'Let the wok cool, wash with a non-abrasive scrubber and dry straight away. Keep the handle out of long soaks.',
  },
};

/** Per product: family, lead, what it is for, size line, Suitable-for, title (if changed), meta. */
const P = {
  'KKA0462-MSWOKRG38': ['rubber', 'Heavy-duty wok cooking for busy stations.', 'large batches of noodles, fried rice and tossed vegetables', 'Room for large batches at a busy wok station.', 'Large batches of noodles, fried rice and stir-fried vegetables.', 'Metal Wok with Rubber Grip Handle 38cm', 'Kitchenary Kart 38cm metal wok with an ultra heavy rubber-grip handle — a steady hold for high-heat noodles and fried rice.'],
  'KKA0463-MSWOKRG40': ['rubber', 'A 40cm metal wok for high-volume service.', 'high-volume stir-frying at restaurant and cloud-kitchen wok stations', 'Extra bowl space for the busiest shifts.', 'Large stir-fry and noodle orders at restaurant wok stations.', 'Metal Wok with Rubber Grip Handle 40cm', 'Buy the Kitchenary Kart 40cm rubber-grip metal wok, sized for high-volume stir-frying on busy restaurant wok lines.'],
  'KKA0464-SSWOK24': ['fullss', 'An all-steel 24cm wok for quick single portions.', 'single portions, eggs and quick tossed vegetables', 'Compact enough for single portions and side dishes.', 'Single-portion stir-fries, eggs and quick sautéed vegetables.', null, 'Kitchenary Kart Full SS Wok, 24cm: an all-stainless steel wok for single portions, eggs and quick sautéed vegetables.'],
  'KKA0465-SSWOK26': ['fullss', 'All stainless steel, sized for small everyday batches.', 'small batches of noodles and vegetables', 'A little more room for two-plate orders.', 'Noodles, vegetables and sautéed dishes in small quantities.', null, 'Shop the Kitchenary Kart 26cm Full SS Wok — one-piece stainless steel for small batches of noodles and vegetables.'],
  'KKA0466-SSWOK28': ['fullss', 'A mid-size stainless steel wok for regular service.', 'regular-service portions of fried rice and noodles', 'A middle size for everyday à la carte orders.', 'Everyday portions of fried rice, noodles and stir-fried vegetables.', null, 'Kitchenary Kart Full SS Wok 28cm, a mid-size stainless steel wok for everyday fried rice, noodle and stir-fry orders.'],
  'KKA0467-SSWOK30': ['fullss', 'More cooking room in one piece of stainless steel.', 'larger portions of fried rice and stir-fries', 'Extra width for larger portions.', 'Larger portions of fried rice, noodles and tossed vegetables.', null, 'Buy the Kitchenary Kart 30cm Full SS Wok: an all-steel wok with extra width for larger portions of fried rice.'],
  'KKA0468-SSWOK32': ['fullss', 'The widest of the all-steel set, for bigger batches.', 'bigger batches of noodles, fried rice and vegetables', 'Wide enough to cook a lot in one go.', 'Noodles, fried rice and vegetables for busy service.', null, 'Kitchenary Kart 32cm Full SS Wok — a wide all-stainless steel wok for bigger batches of noodles and fried rice.'],
  'KKA0469-IWOKWSH': ['side', 'A 45cm iron wok for bulk cooking.', 'bulk stir-fries, fried rice and noodles', 'A wide 45cm bowl for catering quantities.', 'Bulk fried rice, noodles and stir-fries for catering and banquets.', null, 'Shop the Kitchenary Kart 45cm iron wok with side handles for bulk fried rice, noodles and stir-fries in catering kitchens.'],
  'KKA0470-WHIP24': ['ironpan', 'A 24cm iron pan for everyday single servings.', 'single servings, eggs and sautéed vegetables', 'Sized for single servings and quick sautés.', 'Single servings, eggs, sautéed vegetables and shallow frying.', null, 'Kitchenary Kart 24cm iron pan with a wooden handle, sized for single servings, eggs and quick sautés.'],
  'KKA0471-WHIP26': ['ironpan', 'An iron pan for small everyday batches.', 'small batches of sautéed and shallow-fried dishes', 'A touch more room for small batches.', 'Small batches of sautéed dishes, dosa-style toppings and shallow frying.', null, 'Buy the Kitchenary Kart 26cm Wooden Handle Iron Pan — iron cooking surface and a wooden grip for small everyday batches.'],
  'KKA0472-WHIP28': ['ironpan', 'A mid-size iron pan for regular service.', 'everyday sautéing and shallow frying', 'A middle size for everyday orders.', 'Everyday sautéing, shallow frying and pan-tossed dishes.', null, 'Kitchenary Kart Wooden Handle Iron Pan, 28cm: a mid-size iron pan for everyday sautéing and shallow frying.'],
  'KKA0473-WHIP30': ['ironpan', 'More pan surface for larger orders.', 'larger portions of pan-cooked dishes', 'Extra surface for larger orders.', 'Larger portions of pan-cooked and shallow-fried dishes.', null, 'Shop the Kitchenary Kart 30cm iron pan with a wooden handle — extra cooking surface for larger pan-fried orders.'],
  'KKA0474-WHIP32': ['ironpan', 'The widest iron pan of the set, for bigger batches.', 'bigger batches of sautéed and pan-fried food', 'The widest cooking surface of this set.', 'Bigger batches of sautéed and pan-fried food for busy kitchens.', null, 'Kitchenary Kart 32cm Wooden Handle Iron Pan: a wide iron pan for bigger batches of sautéed and pan-fried food.'],
  'KKA0475-WHIWOK34': ['ironwok', 'A 34cm iron wok for high-heat tossing.', 'stir-fries, hakka noodles and fried rice at high heat', 'A roomy bowl for regular wok orders.', 'Stir-fries, hakka noodles and fried rice cooked at high heat.', null, 'Kitchenary Kart 34cm iron wok with a wooden handle for high-heat stir-fries, hakka noodles and fried rice.'],
  'KKA0476-WHIWOK36': ['ironwok', 'An iron wok for busy service lines.', 'busy-service fried rice and noodle orders', 'Bowl space for back-to-back orders.', 'Back-to-back fried rice and noodle orders on busy service lines.', null, 'Buy the Kitchenary Kart 36cm Wooden Handle Iron Wok — sized for back-to-back fried rice and noodle orders.'],
  'KKA0477-WHIWOK38': ['ironwok', 'A 38cm iron wok for large batches.', 'large batches of noodles and stir-fried vegetables', 'Plenty of bowl space per toss.', 'Large batches of noodles, fried rice and stir-fried vegetables.', null, 'Kitchenary Kart Wooden Handle Iron Wok 38cm: an iron wok with room for large batches of noodles and vegetables.'],
  'KKA0478-WHIWOK40': ['ironwok', 'The largest iron wok of this set, for the biggest batches.', 'the biggest batches on a restaurant wok range', 'The widest bowl of this set.', 'The biggest batches of fried rice and noodles on restaurant wok ranges.', null, 'Shop the Kitchenary Kart 40cm iron wok with a wooden handle for the biggest fried rice and noodle batches.'],
  'KKA0479-WHMSWOK34': ['mswok', 'A 34cm mild steel wok for everyday stir-frying.', 'everyday stir-fries and noodles', 'A roomy bowl for everyday orders.', 'Everyday stir-fries, noodles and tossed vegetables.', null, 'Kitchenary Kart 34cm Wooden Handle MS Wok — a mild steel wok for everyday stir-fries and noodles.'],
  'KKA0480-WHMSWOK36': ['mswok', 'A mild steel wok for busier service.', 'busier-service noodle and fried rice orders', 'Space for busier service.', 'Noodle and fried rice orders during busier service.', null, 'Buy the Kitchenary Kart 36cm MS wok with a wooden handle, sized for noodle and fried rice orders during busy service.'],
  'KKA0481-WHMSWOK38': ['mswok', 'The largest MS wok of this set, for large batches.', 'large batches of fried rice and vegetables', 'The widest MS bowl for large batches.', 'Large batches of fried rice, noodles and vegetables.', null, 'Kitchenary Kart Wooden Handle MS Wok, 38cm: a wide mild steel wok for large batches of fried rice and vegetables.'],
  'KKA0482-WHSSWOK24': ['woodss', 'A compact steel wok for single portions.', 'single portions and quick side dishes', 'Compact enough for single portions.', 'Single portions, eggs and quick side dishes.', null, 'Kitchenary Kart 24cm SS wok with a wooden handle — a compact stainless steel wok for single portions and side dishes.'],
  'KKA0483-WHSSWOK26': ['woodss', 'A 26cm steel wok for two-plate orders.', 'small batches of noodles and sautéed vegetables', 'Room for a couple of plates at a time.', 'Small orders of noodles and sautéed vegetables.', null, 'Buy the Kitchenary Kart 26cm Wooden Handle SS Wok for small batches of noodles and sautéed vegetables.'],
  'KKA0484-WHSSWOK28': ['woodss', 'A mid-size steel wok for regular orders.', 'regular orders of fried rice and noodles', 'A middle size for everyday orders.', 'Regular orders of fried rice, noodles and stir-fries.', null, 'Kitchenary Kart Wooden Handle SS Wok 28cm: a mid-size stainless steel wok for everyday fried rice and noodle orders.'],
  'KKA0485-WHSSWOK30': ['woodss', 'More room for larger portions.', 'larger portions of stir-fries and fried rice', 'Extra width for larger portions.', 'Larger portions of stir-fries, fried rice and noodles.', null, 'Shop the Kitchenary Kart 30cm SS wok with a wooden handle — extra width for larger portions of stir-fries.'],
  'KKA0486-WHSSWOK32': ['woodss', 'The widest steel wok of this set.', 'bigger batches of noodles and vegetables', 'Wide enough for a full wok of noodles.', 'Bigger batches of noodles, fried rice and vegetables.', null, 'Kitchenary Kart 32cm Wooden Handle SS Wok, a wide stainless steel wok for bigger batches of noodles and vegetables.'],
};

const src = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n').split('\n');
const out = [];
let sku = '', name = '', skip = false;
const titles = new Map();
let done = 0;
for (let i = 0; i < src.length; i++) {
  const l = src[i];
  if (l.startsWith('[Heading1]')) name = l.replace(/^\[Heading1\] \d+\.\s*/, '');
  const m = /^\[[^\]]*\] SKU:\s*(\S+)/.exec(l);
  if (m) sku = m[1];
  if (l === '[Heading2] Product Description') {
    const p = P[sku];
    if (!p) throw new Error(`no copy for ${sku}`);
    const [fam, lead, use, sizeLine, suit] = p;
    const f = FAMILY[fam];
    const size = /(\d+)cm/.exec(name)?.[1] + 'cm';
    out.push(l,
      `[b] ${lead}`,
      `[] ${f.p1(name.replace(' — ', ' '), use)}`,
      `[] ${f.p2()}`,
      '[Heading2] Key Features',
      `[ListBullet,b] ${size} Size: ${sizeLine}`,
      ...f.bullets.map((b) => `[ListBullet,b] ${b}`),
      `[b] Suitable for: ${suit}`,
      `[b] Care & Use: ${f.care}`);
    skip = true; done++;
    continue;
  }
  if (skip && l === '[Heading2] SEO Title') skip = false;
  if (skip) continue;
  if (l === '[Heading2] SEO Title') {
    const t = P[sku][5] ? `${P[sku][5]}${BRAND}` : src[i + 1].slice(3).replace(/ - (\d+cm)/, ' $1');
    if (t.length > 60) throw new Error(`${sku}: title ${t.length} — ${t}`);
    if (titles.has(t)) throw new Error(`${sku}: duplicate title`);
    titles.set(t, sku);
    out.push(l, `[] ${t}`); i++; continue;
  }
  if (l === '[Heading2] Meta Description') {
    const mm = P[sku][6];
    if (mm.length > 160) throw new Error(`${sku}: meta ${mm.length}`);
    out.push(l, `[] ${mm}`); i++; continue;
  }
  out.push(l);
}
if (done !== 25) throw new Error(`rewrote ${done} of 25`);
const text = out.join('\n');
for (const w of ['suitable ', 'compatible', 'dedicated', 'clearly defined cooking size', 'Size-Based Choice']) if (text.toLowerCase().includes(w.toLowerCase()) && !/Suitable for:/.test(w)) {
  const hits = text.split('\n').filter((x) => x.toLowerCase().includes(w.toLowerCase()) && !x.includes('Search') && !/^\[\] [a-z]/.test(x) && !x.startsWith('[b] Suitable for:'));
  if (hits.length) throw new Error(`"${w}" still present: ${hits[0].slice(0, 100)}`);
}
writeFileSync(OUT, text);
console.log(`${OUT} · 25 rewritten · ${titles.size} titles unique`);
