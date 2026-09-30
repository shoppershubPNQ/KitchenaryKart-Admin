/** Lifter & scraper descriptions (22), rewritten from the owner's document (30 Sep 2026).
 *
 *  22 different products, but the document gave most of them the same lines
 *  ("Provides a dedicated gripping section…" ×8, "Avoid prolonged soaking of
 *  the wooden handle" ×14, "suitable" ×83, "compatible" ×57). Owner rule: no
 *  repeated words — so every product is written on its own.
 *
 *  Facts: the document's (type, material, size/model number) plus what each
 *  listing's OWN photos show — printed dimensions, holes/slots/teeth, the
 *  folding handle, the hanging hole, what the photos show it being used for.
 *  The 10"/12" round pizza lifters' photos say "aluminium" while the name and
 *  document say SS: the copy states neither (owner asked).
 *
 *  Usage: node scripts/annotate-lifter-22.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const SRC = 'scripts/docs/Kitchenary_Kart_Lifter_Scraper_22_Updated_Verified_SKU_Descriptions.txt';
const OUT = 'scripts/docs/lifter-22-annotated.txt';
const BRAND = ' | Kitchenary Kart';

const P = {
  'KKA0207-SSDS': {
    lead: 'Cut, lift and measure dough with one flat steel blade.',
    p: ['The Kitchenary Kart Full SS Dough Scraper with Markings 15cm has a 15 x 12 cm blade with a rolled steel grip along the top and inch and centimetre markings printed across the face.', 'Use it to divide dough into even pieces, lift sticky batches off the bench and scrape the worktop clean afterwards. The straight edge also cuts vegetables on the board.'],
    b: ['15 x 12 cm Blade: Wide enough to lift a full dough piece.', 'Printed Markings: Inch and cm scale for sizing portions by eye.', 'Rolled Top Grip: Steel handle along the full width of the blade.'],
    suit: 'Bread and pizza dough portioning, pastry work and clearing flour from the bench.',
    care: 'Wash and dry after use. The bottom edge is thin, so keep fingers clear when chopping.',
    title: 'Full SS Dough Scraper with Markings 15cm',
    meta: 'Kitchenary Kart 15cm full SS dough scraper with printed inch and cm markings: divide dough, lift it off the bench and scrape the worktop clean.',
  },
  'KKA0208-66': {
    lead: 'A long plain turner for flat-top griddles.',
    p: ['The Kitchenary Kart Plastic Black Handle SS Rectangle Lifter Plain - No.66 measures 39 cm end to end, with a 7.2 cm wide steel blade set at an angle.', 'The flat, unperforated blade slides under pancakes, dosas and eggs on a hot plate, and the black handle has a hole for hanging on a rail.'],
    b: ['39 cm Length: Keeps the hand back from a hot griddle.', 'Plain 7.2 cm Blade: Solid face for thin, soft food.', 'Black Handle with Hanging Hole: Hangs up between services.'],
    suit: 'Pancakes, dosas, eggs and other thin items on a flat-top griddle.',
    care: 'Wash in warm soapy water and dry. Keep the plastic grip away from the flame and the hot plate edge.',
    title: 'Black Handle SS Rectangle Lifter No.66',
    meta: 'Kitchenary Kart No.66 plain SS rectangle lifter, 39cm long with a 7.2cm blade and black handle, for pancakes, dosas and eggs on the griddle.',
  },
  'KKA0209-67': {
    lead: 'A griddle turner that lets fat drain away.',
    p: ['The Kitchenary Kart Plastic Black Handle SS Rectangle Lifter with Holes - No.67 is about 14.5 inches long with a 3 inch wide blade punched with rows of holes.', 'Grease runs off through the holes as you turn burgers, steaks and fish, and the straight front edge also chops and gathers food on the plate.'],
    b: ['Perforated Blade: Rows of holes let oil drain off.', '14.5 in Length: A long reach across the plate.', 'Black Handle: Angled neck lifts the grip clear of the food.'],
    suit: 'Burgers, steaks, fish and chopped vegetables on a griddle or barbecue.',
    care: 'Scrub the holes clear of grease after use and dry. Do not rest the plastic handle on the hot griddle.',
    title: 'Black Handle SS Lifter with Holes No.67',
    meta: 'Kitchenary Kart No.67 SS lifter with holes and a black handle, 14.5in long, so grease drains away while you turn burgers, steak and fish.',
  },
  'KKA0210-PSL': {
    lead: 'A wide slotted lifter for pizza and large portions.',
    p: ['The Kitchenary Kart Plastic Black Handle SS Square Lifter 25x25cm has a 25 cm wide blade cut with long slots, on a black handle for a total length of about 43.5 cm.', 'It gets under a whole pizza, a tray bake or a large omelette in one move, and the slots let steam and oil escape so the base stays crisp.'],
    b: ['25 cm Square Blade: Supports a full pizza or large portion.', 'Long Slots: Let steam and oil escape from under the food.', 'Black Handle: Firm grip for lifting a heavy load.'],
    suit: 'Whole pizzas, tray bakes, large omelettes and flatbreads.',
    care: 'Wash the slots clean after use and dry. Keep the handle away from direct flame.',
    title: 'Black Handle SS Square Lifter 25x25cm',
    meta: 'Kitchenary Kart 25x25cm slotted SS square lifter with a black handle, wide enough to lift a whole pizza, tray bake or large omelette.',
  },
  'KKA0211-SS2.1SR': {
    lead: 'Cut rolled dough into even strips in one pass.',
    p: ['The Kitchenary Kart SS 2 in 1 Scraper + Roller carries a row of steel cutting wheels on a 7 cm wide roller head, with a 21 cm stainless steel handle ending in a hanging loop.', 'Roll it across a sheet of dough to cut neat parallel strips for noodles, lattice tops and pastry twists without measuring each line.'],
    b: ['Multi-Wheel Roller: Cuts several strips at once.', '21 cm Steel Handle: With a loop for hanging.', '2 in 1 Tool: Scraper and roller in one piece.'],
    suit: 'Fresh noodles, pie lattices, pastry twists and even dough strips.',
    care: 'Brush flour and dough out from between the wheels, then wash and dry fully before storing.',
    title: 'SS 2 in 1 Dough Scraper + Roller',
    meta: 'Kitchenary Kart SS 2 in 1 scraper and roller with a row of cutting wheels, for slicing rolled dough into even strips for noodles and lattices.',
  },
  'KKA0212-SSDPC': {
    lead: 'A curved scraper with a measuring scale on the blade.',
    p: ['The Kitchenary Kart SS Dough Pastry Cutter with Measuring Scale - Black has a half-moon steel blade with a black grip along the top, a ruler along the edge and a cup-to-ml conversion table printed on the face.', 'The straight edge cuts dough, butter and fudge into portions, and the curved top sits comfortably in the palm while you scoop chopped food off the board.'],
    b: ['Measuring Scale: Ruler and conversion table on the blade.', 'Black Top Grip: Rounded handle across the blade.', 'Straight Cutting Edge: Portions dough, butter and fudge.'],
    suit: 'Dough portioning, butter blocks, fudge and moving chopped fruit or vegetables.',
    care: 'Wash after use and dry fully. Mind the straight edge when cutting.',
    title: 'SS Dough Cutter with Measuring Scale',
    meta: 'Kitchenary Kart SS dough pastry cutter with a black grip and a measuring scale on the blade, for portioning dough, butter and fudge.',
  },
  'KKA0213-WFCPL': {
    lead: 'A folding pizza peel for the oven door.',
    p: ['The Kitchenary Kart Wooden Flat Foldable + Curved Handle SS Pizza Lifter 36x31cm has a 31 cm wide blade and a wooden handle that folds at a metal hinge, for a total length of about 60 cm when open.', 'Slide it under a pizza to load or pull it from the oven, then fold it down to store the peel in a small space. A cord at the end lets it hang on a hook.'],
    b: ['36 x 31 cm Blade: Carries a full-size pizza.', 'Folding Wooden Handle: Hinges down for compact storage.', 'Hanging Cord: Keeps the peel off the counter.'],
    suit: 'Loading and unloading pizza, flatbreads and baked items in deck and home ovens.',
    care: 'Wipe the peel clean once cool and dry it. Fold it for storage and keep the wood out of long soaks.',
    title: 'Foldable Handle SS Pizza Lifter 36x31cm',
    meta: 'Kitchenary Kart 36x31cm SS pizza lifter with a foldable wooden handle, about 60cm long open, for loading and pulling pizza from the oven.',
  },
  'KKA0214-WRELST': {
    lead: 'A barbecue turner with holes and a toothed edge.',
    p: ['The Kitchenary Kart Wooden Flat Handle SS Rectangle Lifter + Scraper with Side Teeth 19x10cm has a perforated 19 x 10 cm blade with a serrated side, on a wooden handle about 31 cm long overall.', 'Flip burgers and chicken on the grill, let fat run off through the holes, and use the toothed side to cut through meat or scrape the grate.'],
    b: ['Side Teeth: Serrated edge for cutting and scraping.', 'Perforated 19 x 10 cm Blade: Fat drains through the holes.', 'Wooden Flat Handle: Riveted grip for heavy turning.'],
    suit: 'Burgers, chicken, kebabs and grill-plate scraping.',
    care: 'Clean grease from the holes and teeth after use and dry. The toothed edge can be sharp, so take care, and keep the wood out of soaking water.',
    title: 'SS Lifter Scraper with Side Teeth 19x10cm',
    meta: 'Kitchenary Kart 19x10cm SS lifter and scraper with side teeth, holes and a wooden handle, for turning burgers and scraping the grill.',
  },
  'KKA0215-24': {
    lead: 'A plain wooden-handle turner for everyday griddle work.',
    p: ['The Kitchenary Kart Wooden Flat Handle SS Rectangle Lifter Plain - No.24 is 28 cm long with a 7 cm wide solid blade and a riveted wooden handle.', 'The offset neck keeps your knuckles off the plate while you flip, smash and move food, making it a go-to on teppanyaki, flat-top and tawa stations.'],
    b: ['Solid 7 cm Blade: No holes, so batters and sauces stay put.', 'Offset Neck: Handle sits above the cooking surface.', 'Riveted Wooden Handle: Secure grip for daily use.'],
    suit: 'Teppanyaki, tawa dishes, smashed burgers and stir-fried vegetables.',
    care: 'Wash and dry after service. Wipe the wood instead of soaking it.',
    title: 'Wooden Handle SS Rectangle Lifter No.24',
    meta: 'Kitchenary Kart No.24 plain SS rectangle lifter, 28cm long with a 7cm blade and wooden handle, for teppanyaki, tawa and flat-top cooking.',
  },
  'KKA0216-30': {
    lead: 'A slotted turner for toast, fish and fried food.',
    p: ['The Kitchenary Kart Wooden Flat Handle SS Rectangle Lifter with 4 Holes - No.30 has a 7.4 cm wide blade cut with four long slots and a wooden handle, 32.5 cm in all.', 'Oil and butter drain through the slots as you lift toast, fish fillets and fried items from the pan.'],
    b: ['4 Long Slots: Oil drains back into the pan.', '32.5 cm Length: Comfortable reach over a stove.', 'Wooden Handle: Riveted to the steel neck.'],
    suit: 'Toast, fish fillets, cutlets and shallow-fried food.',
    care: 'Clear the slots after use, wash and dry. Do not leave the handle in water.',
    title: 'Wooden Handle SS Lifter with 4 Holes No.30',
    meta: 'Kitchenary Kart No.30 SS lifter with four long slots and a wooden handle, 32.5cm long, for lifting toast, fish and fried food from the pan.',
  },
  'KKA0217-69': {
    lead: 'A large perforated turner for heavy griddle work.',
    p: ['The Kitchenary Kart Wooden Flat Handle SS Rectangle Lifter with Holes Big - No.69 is about 32 cm long with a 9 cm wide blade covered in drainage holes and a riveted wooden handle.', 'The wide face carries big burger patties, steaks and hash browns, while the holes let fat run back onto the plate.'],
    b: ['9 cm Perforated Blade: Big enough for large patties.', 'Drainage Holes: Fat and oil fall away as you lift.', 'Wooden Handle: Keeps a steady hold under weight.'],
    suit: 'Large burger patties, steaks, hash browns and griddled meat.',
    care: 'Scrub the holes free of grease, rinse and dry. Keep the wood dry between uses.',
    title: 'SS Lifter with Holes, Big - No.69',
    meta: 'Kitchenary Kart No.69 big SS lifter with holes and a wooden handle, a 9cm perforated blade for large burger patties, steaks and hash browns.',
  },
  'KKA0218-23': {
    lead: 'A compact perforated turner for pans and small griddles.',
    p: ['The Kitchenary Kart Wooden Flat Handle SS Rectangle Lifter with Holes Small - No.23 is 28 cm long with a 7 cm wide blade punched with holes and a wooden handle.', 'It is handy in a frying pan or on a small hot plate for turning prawns, fish and tikki while the oil drains through.'],
    b: ['7 cm Perforated Blade: Fits inside smaller pans.', '28 cm Length: Easy to control at close range.', 'Wooden Handle: Riveted for a firm hold.'],
    suit: 'Prawns, fish, tikki and small portions in a frying pan.',
    care: 'Wash, rinse the holes and dry fully. Avoid soaking the wooden handle.',
    title: 'SS Lifter with Holes, Small - No.23',
    meta: 'Kitchenary Kart No.23 small SS lifter with holes, 28cm long with a 7cm blade, for turning prawns, fish and tikki in a frying pan.',
  },
  'KKA0219-WRPL6': {
    lead: 'A round lifter for pancakes and small pizzas.',
    p: ['The Kitchenary Kart Wooden Flat Handle SS Round Lifter 6" has a 15 cm round blade on an angled neck, about 34 cm long with its wooden handle.', 'The circle matches pancakes, uttapam, small pizzas and cake bases, so the whole piece is supported as you lift it.'],
    b: ['15 cm Round Blade: Matches round food.', 'Angled Neck: Slides flat under the food.', 'Wooden Handle: Riveted grip with a hanging hole.'],
    suit: 'Pancakes, uttapam, small pizzas and cake layers.',
    care: 'Wash the blade and dry it, and wipe the handle clean rather than soaking it.',
    title: 'Wooden Handle SS Round Lifter 6"',
    meta: 'Kitchenary Kart 6in round SS lifter with a 15cm blade and wooden handle, for lifting pancakes, uttapam, small pizzas and cake layers.',
  },
  'KKA0220-WRPL10': {
    lead: 'A round peel sized for 10 inch pizzas.',
    p: ['The Kitchenary Kart Wooden Flat Handle SS Round Pizza Lifter 10" has a 10 inch round blade on a short wooden handle with a hole for hanging.', 'Use it to move a pizza from the oven to the board or to serve a whole pie at the table. The round shape also suits cakes and tarts.'],
    b: ['10 inch Round Blade: Fits a medium pizza.', 'Short Wooden Handle: Good control at the counter.', 'Hanging Hole: Stores on a hook.'],
    suit: 'Medium pizzas, cakes and tarts.',
    care: 'Let it cool, then wash and dry the blade. Hang it by the handle hole and keep the wood out of standing water.',
    title: 'Wooden Handle Round Pizza Lifter 10"',
    meta: 'Kitchenary Kart 10in round pizza lifter with a wooden handle and hanging hole, for moving and serving medium pizzas, cakes and tarts.',
  },
  'KKA0221-WRPL12': {
    lead: 'A round peel sized for 12 inch pizzas.',
    p: ['The Kitchenary Kart Wooden Flat Handle SS Round Pizza Lifter 12" has a 12 inch round blade, a riveted wooden handle and a hanging hole at the end.', 'It carries a large pizza from oven to cutting board in one piece, and works just as well for big cakes and quiches.'],
    b: ['12 inch Round Blade: Holds a large pizza.', 'Riveted Wooden Handle: Secure under a full load.', 'Hanging Hole: Keeps the peel off the counter.'],
    suit: 'Large pizzas, big cakes and quiches.',
    care: 'Clean the blade after service, dry it and hang it from the handle hole. The wood should not be soaked.',
    title: 'Wooden Handle Round Pizza Lifter 12"',
    meta: 'Kitchenary Kart 12in round pizza lifter with a riveted wooden handle, for carrying large pizzas, cakes and quiches from oven to board.',
  },
  'KKA0222-147': {
    lead: 'A wedge-shaped server for cakes and pies.',
    p: ['The Kitchenary Kart Wooden Flat Handle SS Triangle Lifter Plain - No.147 has a 6 cm wide triangular blade and a wooden handle, 25 cm long.', 'The pointed tip slips under a slice of cake, pie or pizza and lifts it onto the plate without breaking the layers.'],
    b: ['Triangle Blade: Shaped like a slice.', '25 cm Length: Neat for plating at the counter.', 'Wooden Handle: Riveted to the blade.'],
    suit: 'Cake slices, pie, pastries and pizza wedges.',
    care: 'Wash and dry after serving, and keep the wooden handle away from long soaks.',
    title: 'Wooden Handle SS Triangle Lifter No.147',
    meta: 'Kitchenary Kart No.147 SS triangle lifter with a wooden handle, 25cm long, for serving cake slices, pie, pastries and pizza wedges.',
  },
  'KKA0223-32': {
    lead: 'A wide angled scraper for flipping and cleaning the plate.',
    p: ['The Kitchenary Kart Wooden Flat Handle SS U Shaped Cross Angled Scraper - No.32 has a 10 cm wide blade that flares out from the handle, 21.7 cm long in all.', 'The broad straight edge flips eggs, burgers, pancakes and fish, then scrapes the griddle clean between orders.'],
    b: ['10 cm Flared Blade: Wide edge for flipping and scraping.', 'Short 21.7 cm Body: Close control on the plate.', 'Wooden Flat Handle: Riveted in three places.'],
    suit: 'Eggs, burgers, pancakes, fish and scraping the griddle between orders.',
    care: 'Use on flat surfaces without heavy force. Wash, dry and keep the handle out of water.',
    title: 'SS U Shaped Cross Angled Scraper No.32',
    meta: 'Kitchenary Kart No.32 SS U shaped cross angled scraper with a 10cm flared blade, for flipping eggs and burgers and scraping the griddle clean.',
  },
  'KKA0224-28': {
    lead: 'A broad turner for steaks and large cuts.',
    p: ['The Kitchenary Kart Wooden Flat Handle SS U Shaped Lifter Big - No.28 has a 10 cm wide blade on a wooden handle, 28 cm long overall.', 'The wide face gets fully under steaks, chops and grilled vegetables on a grill pan, so heavy pieces turn over in one go.'],
    b: ['10 cm Wide Blade: Supports heavy cuts.', '28 cm Length: Reach across a grill pan.', 'Wooden Handle: Riveted for strength.'],
    suit: 'Steaks, chops, grilled vegetables and large patties.',
    care: 'Wash the blade after grilling and dry it. Wipe the wooden handle rather than soaking it.',
    title: 'SS U Shaped Lifter Big No.28',
    meta: 'Kitchenary Kart No.28 big SS U shaped lifter with a 10cm blade and wooden handle, for turning steaks, chops and grilled vegetables.',
  },
  'KKA0225-73': {
    lead: 'A narrow turner for fish and pan work.',
    p: ['The Kitchenary Kart Wooden Flat Handle SS U Shaped Lifter Small - No.73 has a 6 cm wide blade and a wooden handle, 28 cm long.', 'Its slim face fits inside a frying pan to lift fish fillets, eggs and cutlets without crowding the pan.'],
    b: ['6 cm Blade: Slim enough for a crowded pan.', '28 cm Length: Easy control at the stove.', 'Wooden Handle: Riveted grip.'],
    suit: 'Fish fillets, fried eggs, cutlets and pan-fried food.',
    care: 'Wash and dry after each use, and do not leave the handle soaking.',
    title: 'SS U Shaped Lifter Small No.73',
    meta: 'Kitchenary Kart No.73 small SS U shaped lifter with a 6cm blade and wooden handle, for lifting fish fillets, eggs and cutlets in the pan.',
  },
  'KKA0226-WDS': {
    lead: 'A bench scraper with a wooden grip and a printed scale.',
    p: ['The Kitchenary Kart Wooden Handle Dough Scraper with Markings 15cm has a 15 x 11 cm steel blade with a measuring scale along the edge and a wooden grip riveted across the top.', 'Cut and portion dough, lift it from the bench and scrape up flour and scraps at the end of a bake.'],
    b: ['15 x 11 cm Blade: Straight edge for clean cuts.', 'Measuring Scale: Sizes dough pieces as you cut.', 'Wooden Top Grip: Full-width handle for pressure.'],
    suit: 'Bread, pizza and roti dough portioning and clearing the bench.',
    care: 'Wash the blade and dry it straight away. Wipe the grip rather than soaking it.',
    title: 'Wooden Handle Dough Scraper 15cm',
    meta: 'Kitchenary Kart 15cm wooden handle dough scraper with a printed scale, for cutting and portioning dough and clearing the bench.',
  },
  'KKA0227-22': {
    lead: 'A pie server with a smooth round handle.',
    p: ['The Kitchenary Kart Wooden Round Handle SS Triangle Lifter Plain - No.22 pairs a triangular steel blade with a turned wooden handle.', 'Slide it under a slice of pie, tart or cake and set it on the plate cleanly, crust and filling together.'],
    b: ['Triangle Blade: Sized for a single slice.', 'Plain Edges: Gentle on plates and bakeware.', 'Round Wooden Handle: Comfortable when serving.'],
    suit: 'Pie, tart and cake slices at the counter or table.',
    care: 'Wash after use and dry. Keep the wood out of long soaks.',
    title: 'Round Handle SS Triangle Lifter No.22',
    meta: 'Kitchenary Kart No.22 SS triangle lifter with a round wooden handle, for serving pie, tart and cake slices cleanly onto the plate.',
  },
  'KKA0228-21': {
    lead: 'Cut and serve with the same tool.',
    p: ['The Kitchenary Kart Wooden Round Handle SS Triangle Lifter with One Side Sharp - No.21 has a triangular steel blade with one sharpened side and a round wooden handle.', 'Cut through a pie or cake with the sharp side, then lift the slice out on the flat blade.'],
    b: ['One Sharp Side: Cuts through crust and layers.', 'Triangle Blade: Lifts the slice out whole.', 'Round Wooden Handle: Easy grip for cutting.'],
    suit: 'Pies, tarts, cakes and pizza slices.',
    care: 'The sharp side cuts, so wash it carefully, dry it and store it away from loose utensils. Do not soak the wood.',
    title: 'SS Triangle Lifter One Side Sharp No.21',
    meta: 'Kitchenary Kart No.21 SS triangle lifter with one sharp side and a round wooden handle, to cut and serve pie, cake and pizza slices.',
  },
};

const src = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n').split('\n');
const out = [];
let sku = '', skip = false, done = 0;
const titles = new Set();
for (let i = 0; i < src.length; i++) {
  const l = src[i];
  const m = /^\[[^\]]*\] SKU:\s*(\S+)/.exec(l);
  if (m) sku = m[1];
  if (l === '[Heading2] Product Description') {
    const p = P[sku];
    if (!p) throw new Error(`no copy for ${sku}`);
    if (!p.p[0].includes('Kitchenary Kart')) throw new Error(`${sku}: first paragraph must name the product`);
    out.push(l, `[b] ${p.lead}`, ...p.p.map((x) => `[] ${x}`), '[Heading2] Key Features',
      ...p.b.map((x) => `[ListBullet,b] ${x}`), `[b] Suitable for: ${p.suit}`, `[b] Care & Use: ${p.care}`);
    skip = true; done++;
    continue;
  }
  if (skip && l === '[Heading2] SEO Title') skip = false;
  if (skip) continue;
  if (l === '[Heading2] SEO Title') {
    const t = P[sku].title + BRAND;
    if (t.length > 60) throw new Error(`${sku}: title ${t.length} — ${t}`);
    if (titles.has(t)) throw new Error(`${sku}: duplicate title`);
    titles.add(t);
    out.push(l, `[] ${t}`); i++; continue;
  }
  if (l === '[Heading2] Meta Description') {
    const mm = P[sku].meta;
    if (mm.length > 160 || !mm.endsWith('.')) throw new Error(`${sku}: meta ${mm.length}`);
    out.push(l, `[] ${mm}`); i++; continue;
  }
  out.push(l);
}
if (done !== 22) throw new Error(`rewrote ${done} of 22`);
const body = out.join('\n');
for (const w of ['compatible', 'dedicated', 'clearly identified', 'suitable ']) {
  const hit = out.find((x) => x.toLowerCase().includes(w) && !x.startsWith('[b] Suitable for:') && !x.startsWith('[] ') === false && !/Search Phrases/.test(x) && /^\[(b|ListBullet,b)\]|^\[\] [A-Z]/.test(x));
  if (hit) throw new Error(`"${w}" still present: ${hit.slice(0, 90)}`);
}
writeFileSync(OUT, body);
console.log(`${OUT} · ${done} rewritten · ${titles.size} titles unique`);
