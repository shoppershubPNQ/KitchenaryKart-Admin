/** Strainer descriptions (23 of 24), rewritten from the owner's document (30 Sep 2026).
 *
 *  The document was one template per family, pasted 5–8 times word for word
 *  ("Provides a specific size choice…", "Suitable for: Noodles and other
 *  compatible boiled foods…"), with "suitable" ×107 and "compatible" ×55.
 *  Owner rule: no repeated words.
 *
 *  Facts are the document's plus what the listing's own photos show:
 *   - both rice strainers: perforated stainless steel bowl (Full SS = steel
 *     handle; Wooden Handle = steel shaft with a wooden grip at the end);
 *   - noodle strainer: reinforced wire-mesh basket on a long flat wooden
 *     handle, shown lifting noodles and fried food;
 *   - pasta boiler: perforated cylindrical basket with a hook that rests on
 *     the pot rim.
 *  KKA0426-SSCFS is LEFT OUT: its photos show a batter/sauce dispenser funnel
 *  with a lever valve, not a strainer — held for the owner.
 *
 *  Usage: node scripts/annotate-strainer-24.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const SRC = 'scripts/docs/Kitchenary_Kart_Strainer_24_Updated_Reference_Style.txt';
const OUT = 'scripts/docs/strainer-23-annotated.txt';
const BRAND = ' | Kitchenary Kart';
const HELD = new Set(['KKA0426-SSCFS']);

const FAMILY = {
  fullss: {
    title: (s) => `Full SS Rice Strainer ${s}`,
    p1: (n, u) => `The Kitchenary Kart ${n} is a perforated stainless steel strainer for ${u}.`,
    p2: 'Bowl and handle are both stainless steel, and the holes let water or oil run off quickly as food is lifted out.',
    bullets: ['Perforated Bowl: Holes all over for quick draining.', 'All-Steel Build: Stainless steel from rim to handle end.'],
    care: 'Wash after use, clearing rice and starch from the holes, and dry before storing. The steel handle warms up over a hot pot, so hold it with a cloth if needed.',
  },
  woodrice: {
    title: (s) => `Wooden Handle SS Rice Strainer ${s}`,
    p1: (n, u) => `The Kitchenary Kart ${n} is built for ${u}.`,
    p2: 'A perforated stainless steel bowl sits on a steel shaft with a wooden grip at the end, keeping the hand back from steam and hot water.',
    bullets: ['Perforated SS Bowl: Drains water as rice or boiled food is lifted.', 'Wooden Grip: Fitted at the end of a steel shaft.'],
    care: 'Rinse the holes clear of starch after use and dry the bowl. Do not soak the grip.',
  },
  noodle: {
    title: (s) => `Heavy SS Noodle Strainer ${s}`,
    p1: (n, u) => `The Kitchenary Kart ${n} handles ${u}.`,
    p2: 'Its wire mesh basket is reinforced with steel ribs, and the long flat handle keeps hands well back from boiling water or hot oil.',
    bullets: ['Reinforced Wire Mesh: Heavy SS wire with support ribs across the basket.', 'Flat Wooden Handle: Long enough to keep hands clear of the heat.'],
    care: 'Shake off water or oil after use, brush the mesh to clear trapped bits and dry it fully. Keep the wood out of long soaks.',
  },
  pasta: {
    title: (s) => `Cylindrical Pasta Boiler/Strainer ${s}`,
    p1: (n, u) => `The Kitchenary Kart ${n} is sized for ${u}.`,
    p2: 'The perforated steel cylinder goes straight into boiling water, and a hook on the handle rests on the pot rim so it stays in place while the food cooks.',
    bullets: ['Perforated Cylinder Basket: Water flows through while the food stays inside.', 'Pot-Rim Hook: Hangs on the edge of the pot.'],
    care: 'Check that it fits your pot before cooking. Lift it out slowly to let the water drain, then wash and dry after use. Keep the handle away from the flame.',
  },
};

/** family, lead, use, size line, Suitable-for, meta */
const P = {
  'KKA0440-SSRS24': ['fullss', 'A compact all-steel strainer for everyday draining.', 'draining rice and lifting noodles or dumplings from the pot', 'Handy for smaller pots and single batches.', 'Rice, noodles and dumplings in small batches.', 'Kitchenary Kart Full SS Rice Strainer 24cm: a perforated all-steel strainer for draining rice and lifting noodles or dumplings.'],
  'KKA0441-SSRS26': ['fullss', 'Perforated steel for quick draining.', 'draining rice and scooping boiled vegetables', 'A little more room for regular batches.', 'Rice, boiled vegetables and noodles.', 'Buy the Kitchenary Kart 26cm Full SS Rice Strainer, perforated stainless steel for draining rice and scooping boiled vegetables.'],
  'KKA0442-SSRS28': ['fullss', 'A mid-size strainer for daily kitchen batches.', 'daily rice batches and lifting fried snacks out of oil', 'A middle size for everyday service.', 'Daily rice batches, fried snacks and boiled food.', 'Kitchenary Kart Full SS Rice Strainer 28cm, a mid-size perforated strainer for daily rice batches and lifting fried snacks.'],
  'KKA0443-SSRS30': ['fullss', 'A wider bowl for larger pots.', 'larger batches of rice and blanched vegetables', 'Extra width for bigger pots.', 'Larger rice batches and blanched vegetables.', 'Shop the Kitchenary Kart 30cm Full SS Rice Strainer with a wide perforated bowl for larger rice batches and blanched vegetables.'],
  'KKA0444-SSRS32': ['fullss', 'The widest all-steel strainer of this set.', 'bulk rice cooking in hotel and canteen kitchens', 'Takes a big scoop in one lift.', 'Bulk rice and boiled food for hotels and canteens.', 'Kitchenary Kart 32cm Full SS Rice Strainer: the widest perforated all-steel strainer of the set, for bulk rice in hotels and canteens.'],
  'KKA0445-WHSSRS24': ['woodrice', 'Steel bowl, wooden grip, compact size.', 'draining rice and lifting boiled meat or vegetables out of stock', 'Suits smaller pots.', 'Rice, boiled meat and vegetables in small pots.', 'Kitchenary Kart 24cm Wooden Handle SS Rice Strainer, a perforated steel bowl for draining rice and lifting boiled meat or vegetables.'],
  'KKA0446-WHSSRS26': ['woodrice', 'A 26cm perforated strainer with a wooden grip.', 'regular batches of rice and boiled vegetables', 'A touch more room per scoop.', 'Regular batches of rice and boiled vegetables.', 'Buy the Kitchenary Kart Wooden Handle SS Rice Strainer 26cm for regular batches of rice and boiled vegetables.'],
  'KKA0447-WHSSRS28': ['woodrice', 'A mid-size strainer for everyday rice service.', 'everyday rice service and lifting dumplings', 'A middle size for daily use.', 'Everyday rice service, dumplings and noodles.', 'Kitchenary Kart Wooden Handle SS Rice Strainer, 28cm: a mid-size perforated strainer for everyday rice, dumplings and noodles.'],
  'KKA0448-WHSSRS30': ['woodrice', 'More bowl for bigger pots.', 'bigger pots of rice and stock', 'Wider for large pots.', 'Rice and boiled food from large pots.', 'Shop the Kitchenary Kart 30cm Wooden Handle SS Rice Strainer, a wide perforated bowl for rice and boiled food from large pots.'],
  'KKA0449-WHSSRS32': ['woodrice', 'The widest wooden-grip strainer of the set.', 'bulk rice in hotel, canteen and catering kitchens', 'Moves a large scoop at once.', 'Bulk rice for hotels, canteens and catering.', 'Kitchenary Kart 32cm Wooden Handle SS Rice Strainer, the widest of the set, for bulk rice in hotel, canteen and catering kitchens.'],
  'KKA0427-WHSSNS20': ['noodle', 'A compact mesh strainer for single portions.', 'single portions of noodles and small fried batches', 'Sized for one portion at a time.', 'Single noodle portions, dumplings and small fried batches.', 'Kitchenary Kart 20cm Heavy SS Noodle Strainer with a flat wooden handle, for single noodle portions and small fried batches.'],
  'KKA0428-WHSSNS22': ['noodle', 'Wire mesh on a long wooden handle.', 'noodle portions and blanched greens', 'Room for a generous single portion.', 'Noodle portions and blanched greens.', 'Buy the Kitchenary Kart Heavy SS Noodle Strainer 22cm: reinforced wire mesh on a flat wooden handle for noodles and blanched greens.'],
  'KKA0429-WHSSNS24': ['noodle', 'A 24cm spider for noodles and frying.', 'noodles and deep-fried snacks', 'Suits two-plate orders.', 'Noodles and deep-fried snacks.', 'Kitchenary Kart 24cm Heavy SS Noodle Strainer, a reinforced mesh spider for lifting noodles and deep-fried snacks.'],
  'KKA0430-WHSSNS26': ['noodle', 'Reinforced mesh for busy noodle stations.', 'busy noodle stations and fry counters', 'A mid-size scoop for regular service.', 'Noodles at busy stations and fried items at the fryer.', 'Shop the Kitchenary Kart Heavy SS Noodle Strainer 26cm with a flat wooden handle for busy noodle stations and fry counters.'],
  'KKA0431-WHSSNS28': ['noodle', 'A 28cm mesh basket for larger lifts.', 'larger lifts of noodles, pasta and fried chicken', 'More room per lift.', 'Noodles, pasta and fried chicken.', 'Kitchenary Kart Heavy SS Noodle Strainer, 28cm: reinforced wire mesh for larger lifts of noodles, pasta and fried chicken.'],
  'KKA0432-WHSSNS30': ['noodle', 'Wide mesh for bigger batches.', 'batch noodles and fried items in restaurant kitchens', 'Wide enough for batch cooking.', 'Batch noodles and fried items in restaurant kitchens.', 'Buy the Kitchenary Kart 30cm Heavy SS Noodle Strainer, a wide mesh spider for batch noodles and fried items.'],
  'KKA0433-WHSSNS32': ['noodle', 'A 32cm spider for high-volume kitchens.', 'high-volume noodle and frying work', 'Moves a large batch in one lift.', 'High-volume noodles, dumplings and fried food.', 'Kitchenary Kart 32cm Heavy SS Noodle Strainer with a flat wooden handle, built for high-volume noodle and frying work.'],
  'KKA0434-WHSSNS34': ['noodle', 'The largest mesh strainer of the set.', 'bulk noodles and large fryer batches in catering kitchens', 'The widest scoop of this set.', 'Bulk noodles and large fryer batches for catering.', 'Shop the Kitchenary Kart Heavy SS Noodle Strainer 34cm, the largest of the set, for bulk noodles and large fryer batches.'],
  'KKA0436-WHCPB12': ['pasta', 'A single-portion basket for boiling and draining.', 'single portions of pasta and noodles', 'Sized for a single portion.', 'Single portions of pasta, noodles and blanched vegetables.', 'Kitchenary Kart 12cm Cylindrical Pasta Boiler/Strainer: a perforated SS basket that cooks and drains single portions of pasta.'],
  'KKA0437-WHCPB14': ['pasta', 'Cook and drain in the same basket.', 'pasta and noodle portions cooked to order', 'A little more room per portion.', 'Pasta and noodles cooked to order.', 'Buy the Kitchenary Kart 14cm Pasta Boiler/Strainer with a perforated steel basket and pot-rim hook, for pasta cooked to order.'],
  'KKA0438-WHCPB16': ['pasta', 'A mid-size basket for à la carte orders.', 'à la carte pasta, noodles and blanched greens', 'A middle size for regular orders.', 'À la carte pasta, noodles and blanched greens.', 'Kitchenary Kart Cylindrical Pasta Boiler/Strainer 16cm, a mid-size perforated basket for à la carte pasta, noodles and greens.'],
  'KKA0439-WHCPB18': ['pasta', 'Room for larger servings.', 'larger servings of pasta and dumplings', 'Extra width for bigger servings.', 'Larger servings of pasta and dumplings.', 'Shop the Kitchenary Kart 18cm Pasta Boiler/Strainer, a perforated SS basket that hooks on the pot rim, for larger pasta servings.'],
  'KKA0435-WHCPB20': ['pasta', 'A 20cm basket for sharing portions.', 'sharing portions and batch blanching', 'Room for sharing portions.', 'Sharing portions of pasta and batch-blanched vegetables.', 'Kitchenary Kart 20cm Cylindrical Pasta Boiler/Strainer: a perforated SS basket with a pot-rim hook for sharing portions and blanching.'],
};

const src = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n').split('\n');
const out = [];
let sku = '', name = '', skip = false, held = false, done = 0;
const titles = new Set();
for (let i = 0; i < src.length; i++) {
  const l = src[i];
  if (l.startsWith('[Heading1]')) {
    name = l.replace(/^\[Heading1\] \d+\.\s*/, '');
    const next = /SKU:\s*(\S+)/.exec(src[i + 1] ?? '')?.[1];
    held = HELD.has(next);
    if (held) continue;
  }
  if (held) continue;
  const m = /^\[[^\]]*\] SKU:\s*(\S+)/.exec(l);
  if (m) sku = m[1];
  if (l === '[Heading2] Product Description') {
    const p = P[sku];
    if (!p) throw new Error(`no copy for ${sku}`);
    const [fam, lead, use, sizeLine, suit] = p;
    const f = FAMILY[fam];
    const size = /(\d+)cm/.exec(name)[1] + 'cm';
    const label = fam === 'noodle' || fam === 'pasta' ? 'Basket' : 'Bowl';
    out.push(l,
      `[b] ${lead}`,
      `[] ${f.p1(name.replace(' — ', ' '), use)}`,
      `[] ${f.p2}`,
      '[Heading2] Key Features',
      `[ListBullet,b] ${size} ${label}: ${sizeLine}`,
      ...f.bullets.map((b) => `[ListBullet,b] ${b}`),
      `[b] Suitable for: ${suit}`,
      `[b] Care & Use: ${f.care}`);
    skip = true; done++;
    continue;
  }
  if (skip && l === '[Heading2] SEO Title') skip = false;
  if (skip) continue;
  if (l === '[Heading2] SEO Title') {
    const size = /(\d+)cm/.exec(name)[1] + 'cm';
    const t = FAMILY[P[sku][0]].title(size) + BRAND;
    if (t.length > 60) throw new Error(`${sku}: title ${t.length} — ${t}`);
    if (titles.has(t)) throw new Error(`${sku}: duplicate title`);
    titles.add(t);
    out.push(l, `[] ${t}`); i++; continue;
  }
  if (l === '[Heading2] Meta Description') {
    const mm = P[sku][5];
    if (mm.length > 160) throw new Error(`${sku}: meta ${mm.length}`);
    out.push(l, `[] ${mm}`); i++; continue;
  }
  out.push(l);
}
if (done !== 23) throw new Error(`rewrote ${done} of 23`);
const body = out.join('\n');
for (const w of ['compatible', 'dedicated', 'clearly', 'according to']) {
  if (body.toLowerCase().includes(w)) throw new Error(`"${w}" still present`);
}
const suitHits = out.filter((x) => /suitable/i.test(x) && !x.startsWith('[b] Suitable for:') && !/^\[\] [a-z0-9 ,]+$/.test(x));
if (suitHits.length) throw new Error(`"suitable" still in: ${suitHits[0].slice(0, 90)}`);
writeFileSync(OUT, body);
console.log(`${OUT} · ${done} rewritten · ${titles.size} titles unique · held: ${[...HELD].join(', ')}`);
