/** Build the HSN/GST spec for a category, ready for build-hsn-doc.mjs.
 *
 *  One row per SELLABLE page — a product with sizes or colours contributes one
 *  row per variant, because that is what a customer buys and what appears on
 *  the invoice. The category's spare parts are included under their own
 *  heading, since they carry their own HSN.
 *
 *  Usage: npx tsx scripts/build-category-hsn.ts <key>
 *         npx tsx scripts/build-category-hsn.ts all
 */
import { writeFileSync } from 'fs';
import { prisma } from '../lib/db';

interface Spec {
  key: string;
  title: string;
  header: string;
  subcategories: string[];
  what: string;
  shopUrl: string;
}

const SPECS: Spec[] = [
  { key: 'oven', title: 'Oven Category, HSN and GST', header: 'OVEN',
    subcategories: ['OVEN', 'SPARES FOR OVEN'],
    what: 'electric and gas pizza ovens, proofers and their spare parts',
    shopUrl: 'https://kitchenarykart.com/shop?cat=HOT+EQUIPMENT&sub=OVEN' },
  { key: 'insulation-barrel', title: 'Insulation Barrel Category, HSN and GST', header: 'INSULATION BARREL',
    subcategories: ['INSULATION BARREL'],
    what: 'foam and plastic insulated barrels for hot and cold food service',
    shopUrl: 'https://kitchenarykart.com/shop?cat=BUFFET+%26+TABLEWARE&sub=INSULATION+BARREL' },
  { key: 'ice-crusher', title: 'Ice Crusher Category, HSN and GST', header: 'ICE CRUSHER',
    subcategories: ['ICE CRUSHER', 'SPARES FOR ICE CRUSHER'],
    what: 'electric and manual ice crushers and their spare parts',
    shopUrl: 'https://kitchenarykart.com/shop?cat=COLD+EQUIPMENT&sub=ICE+CRUSHER' },
  { key: 'table-mat', title: 'Table Mat Category, HSN and GST', header: 'TABLE MAT',
    subcategories: ['TABLE MAT'],
    what: 'glossy, jute, flower-design and leather-type table mats',
    shopUrl: 'https://kitchenarykart.com/shop?cat=BUFFET+%26+TABLEWARE&sub=TABLE+MAT' },
  { key: 'slush-machine', title: 'Slush Machine Category, HSN and GST', header: 'SLUSH MACHINE',
    subcategories: [], // matched by name — these two sit in different subcategories
    what: 'electric slush and slushie machines',
    shopUrl: 'https://kitchenarykart.com/shop?cat=COLD+EQUIPMENT' },

  // The categories whose descriptions were rewritten but that had no HSN list yet.
  { key: 'cup-holder', title: 'Cup Holder Category, HSN and GST', header: 'CUP HOLDER',
    subcategories: ['CUP HOLDER'], what: 'ABS fibre and plastic paper-cup holders and dispensers',
    shopUrl: 'https://kitchenarykart.com/shop?cat=BAR+%26+BEVERAGE+ACCESSORIES&sub=CUP+HOLDER' },
  { key: 'juice-dispenser', title: 'Juice Dispenser Category, HSN and GST', header: 'JUICE DISPENSER',
    subcategories: ['JUICE DISPENSER', 'ELECTRIC COOLING JUICE DISPENSER'],
    what: 'electric cooling and warming juice dispensers',
    shopUrl: 'https://kitchenarykart.com/shop?cat=COLD+EQUIPMENT&sub=JUICE+DISPENSER' },
  { key: 'commercial-mixer', title: 'Commercial Mixer Category, HSN and GST', header: 'COMMERCIAL MIXER',
    subcategories: ['COMMERCIAL MIXER'], what: 'spiral and planetary dough mixers',
    shopUrl: 'https://kitchenarykart.com/shop?cat=KITCHEN+%26+BAKING+EQUIPMENT&sub=COMMERCIAL+MIXER' },
  { key: 'pancake-idli-maker', title: 'Pancake and Mini Idli Maker Category, HSN and GST', header: 'PANCAKE/MINI IDLI MAKER',
    subcategories: ['PANCAKE/MINI IDLI MAKER'], what: 'electric and gas pancake, mini idli and mini pizza makers',
    shopUrl: 'https://kitchenarykart.com/shop?cat=HOT+EQUIPMENT&sub=PANCAKE%2FMINI+IDLI+MAKER' },
  { key: 'snowflakes-machine', title: 'Snowflakes Machine Category, HSN and GST', header: 'SNOWFLAKES MACHINE',
    subcategories: ['SNOWFLAKES MACHINE', 'SPARES FOR SNOWFLAKES MACHINE'],
    what: 'electric snowflake ice machines, slushie machines and their spare parts',
    shopUrl: 'https://kitchenarykart.com/shop?cat=COLD+EQUIPMENT&sub=SNOWFLAKES+MACHINE' },
  { key: 'sugarcane-orange', title: 'Orange and Sugarcane Machine Category, HSN and GST', header: 'ORANGE/SUGARCANE MACHINE',
    subcategories: ['ORANGE/SUGARCANE MACHINE'], what: 'electric sugarcane machines and orange / sweet lime juicers',
    shopUrl: 'https://kitchenarykart.com/shop?cat=COLD+EQUIPMENT&sub=ORANGE%2FSUGARCANE+MACHINE' },
  { key: 'cold-display-showcase', title: 'Cold Display Showcase Category, HSN and GST', header: 'COLD DISPLAY SHOWCASE',
    subcategories: ['COLD DISPLAY SHOWCASE'], what: 'curved and straight glass refrigerated display showcases',
    shopUrl: 'https://kitchenarykart.com/shop?cat=COLD+EQUIPMENT&sub=COLD+DISPLAY+SHOWCASE' },
  { key: 'vegetable-cutter', title: 'Commercial Vegetable Cutter Category, HSN and GST', header: 'COMMERCIAL VEGETABLE CUTTER',
    subcategories: ['COMMERCIAL VEGETABLE CUTTER'], what: 'electric commercial vegetable cutters',
    shopUrl: 'https://kitchenarykart.com/shop?cat=KITCHEN+%26+BAKING+EQUIPMENT&sub=COMMERCIAL+VEGETABLE+CUTTER' },
  { key: 'masala-grinder', title: 'Masala and Gravy Grinder Category, HSN and GST', header: 'MASALA & GRAVY GRINDER',
    subcategories: ['MASALA & GRAVY GRINDER', 'SPARES FOR MASALA & GRAVY GRINDER'],
    what: 'electric masala and gravy grinding machines and their spare parts',
    shopUrl: 'https://kitchenarykart.com/shop?cat=HOT+EQUIPMENT&sub=MASALA+%26+GRAVY+GRINDER' },
  { key: 'soup-pot', title: 'Soup Pot Category, HSN and GST', header: 'SOUP POT',
    subcategories: ['SOUP POT'], what: 'electric soup pots and warmers',
    shopUrl: 'https://kitchenarykart.com/shop?cat=HOT+EQUIPMENT&sub=SOUP+POT' },
  { key: 'induction', title: 'Induction Category, HSN and GST', header: 'INDUCTION',
    subcategories: ['INDUCTION'], what: 'commercial induction cooktops and infrared induction models',
    shopUrl: 'https://kitchenarykart.com/shop?cat=HOT+EQUIPMENT&sub=INDUCTION' },
  { key: 'commercial-blender', title: 'Commercial Blender Category, HSN and GST', header: 'COMMERCIAL BLENDER',
    subcategories: ['COMMERCIAL BLENDER'], what: 'immersion blenders, countertop blenders, hand mixers and drink mixers',
    shopUrl: 'https://kitchenarykart.com/shop?cat=COLD+EQUIPMENT&sub=COMMERCIAL+BLENDER' },
];

(async () => {
  const want = process.argv[2] ?? 'all';
  const run = want === 'all' ? SPECS : SPECS.filter((s) => s.key === want);
  if (!run.length) throw new Error(`unknown category "${want}" — try: ${SPECS.map((s) => s.key).join(', ')}, all`);

  for (const spec of run) {
    const ps = await prisma.product.findMany({
      where: spec.subcategories.length
        ? { subcategory: { in: spec.subcategories } }
        : { name: { contains: 'Slush', mode: 'insensitive' } },
      select: {
        sku: true, name: true, hsnCode: true, category: true, subcategory: true,
        variants: { select: { skuSuffix: true, variantValue: true }, orderBy: { id: 'asc' } },
      },
      orderBy: [{ subcategory: 'asc' }, { name: 'asc' }],
    });

    const rows: string[][] = [];
    const spread = new Map<string, number>();
    const noHsn: string[] = [];
    for (const p of ps) {
      const hsn = p.hsnCode ?? '';
      const list = p.variants.length ? p.variants : [{ skuSuffix: p.sku, variantValue: null as string | null }];
      for (const v of list) {
        const sku = v.skuSuffix ?? p.sku;
        if (!hsn) noHsn.push(sku);
        spread.set(hsn || '(blank)', (spread.get(hsn || '(blank)') ?? 0) + 1);
        rows.push([
          String(rows.length + 1),
          p.name + (v.variantValue ? ` — ${v.variantValue}` : ''),
          sku,
          `${p.category} › ${p.subcategory}`,
          hsn,
          '18%',
        ]);
      }
    }

    const out = `scripts/docs/hsn-${spec.key}.json`;
    writeFileSync(out, JSON.stringify({
      title: spec.title,
      header: spec.header,
      intro: `${rows.length} live listings covering ${spec.what}.`,
      link: { text: `${spec.header.replace(/\b\w/g, (c) => c + '').toLowerCase()} category on kitchenarykart.com`, url: spec.shopUrl },
      columns: ['#', 'Model', 'SKU', 'Category', 'HSN code', 'GST'],
      rows,
      notes: [
        'GST: every listing in this category is charged at 18%.',
        'HSN codes are as stored against each listing in the Kitchenary Kart catalogue.',
        'Prices on the website are GST-inclusive; the invoice shows the tax backed out of the selling price.',
      ],
    }, null, 2));

    console.log(`\n${spec.header}: ${rows.length} rows → ${out}`);
    for (const [k, n] of [...spread].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(12)} ${n}`);
    if (noHsn.length) console.log(`    NO HSN on ${noHsn.length}: ${noHsn.slice(0, 8).join(', ')}`);
  }
  await prisma.$disconnect();
})();
