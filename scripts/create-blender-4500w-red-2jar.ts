/**
 * New listing, owner 2026-09-30: the new model of the Electric 2L Commercial
 * Blender 4500W in Red, which comes with two jars (2L + a small 700ml jar).
 * Price from HE 3,250 x 1.30 x 1.18 = 4,985.50 (GST-inclusive), MRP 2x. The
 * existing listing (KKCE0014-BLBL, Red variant KKCE0015-SBL1) is NOT changed.
 *
 * Copied from the Red variant the way admin's Duplicate button copies (category,
 * GST/HSN, specs), with the same guards: created as a DRAFT with stock 0, no
 * Best Seller/New Arrival, no sync link. Images are the old Red model's by URL
 * until the new model's photos arrive; weight is the one-jar weight until the
 * two-jar box is weighed. Description written for the two-jar model — only the
 * facts the owner gave (2 jars, 700ml) plus 4500W / 2L / Red from the listing.
 *
 * Usage: npx tsx scripts/create-blender-4500w-red-2jar.ts [--apply]
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';

const SKU = 'KKCE0041-SBL2J';
const HE = 3250;
const price = Math.round(HE * 1.3 * 1.18 * 100) / 100;
const mrp = Math.round(2 * price * 100) / 100;

const name = 'Electric 2L Commercial Blender 4500W with 700ml Small Jar - Red - New Model';
const description = [
  'Two jars in the box — one for batches, one for single servings.',
  '',
  'The Kitchenary Kart Electric 2L Commercial Blender 4500W (New Model) comes with a 2 litre jar and a small 700 ml jar. Use the big jar for batches of milkshakes, smoothies, lassi and cold coffee, and switch to the small one when an order needs only a glass or two.',
  '',
  'The red body brings a bright finish to juice shops, cafés and restaurant drink counters.',
  '',
  'Key Features',
  '',
  '• Two Jars Included: A 2 litre jar and a 700 ml jar.',
  '• 4500W Motor: Rated for regular commercial drink service.',
  '• 2 Litre Jar: Room for batch orders at busy hours.',
  '• 700 ml Jar: Small quantities without running the big jar half-empty.',
  '• Red Body: A colour that stands out on the counter.',
  '',
  'Suitable for: Milkshakes, smoothies, lassi, cold coffee and single-glass blends.',
  '',
  'Care & Use: Fit the jar and lid securely. Stay below the maximum filling line and follow the recommended running times and rest breaks. Stop the blades before opening or removing the jar. Unplug before cleaning and keep the motor base dry.',
].join('\n');
const metaTitle = '2L Commercial Blender with 700ml Jar Red | Kitchenary Kart';
const metaDescription = 'Kitchenary Kart 4500W commercial blender, new model in red, with a 2L jar for batch orders and a 700ml jar for single servings of shakes and smoothies.';
const metaKeywords = 'electric, commercial, blender, 4500w, 2l, 700ml, two jars, new model, red, cold equipment, commercial blender, restaurant, cafe, juice shop, GST invoice';

(async () => {
  const apply = process.argv.includes('--apply');
  if (metaTitle.length > 60) throw new Error(`title ${metaTitle.length}`);
  if (metaDescription.length > 160) throw new Error(`meta ${metaDescription.length}`);

  const parent = await prisma.product.findUniqueOrThrow({ where: { sku: 'KKCE0014-BLBL' } });
  const red = await prisma.productVariant.findUniqueOrThrow({ where: { id: 1209 } });
  if (red.skuSuffix !== 'KKCE0015-SBL1' || red.variantValue !== 'Red') throw new Error('source is not the Red variant');
  const taken = await prisma.product.findFirst({ where: { sku: { equals: SKU, mode: 'insensitive' } } });
  const takenV = await prisma.productVariant.findFirst({ where: { skuSuffix: { equals: SKU, mode: 'insensitive' } } });
  if (taken || takenV) throw new Error(`${SKU} already exists`);
  const dupTitle = await prisma.product.findFirst({ where: { OR: [{ name }, { metaTitle }] } });
  if (dupTitle) throw new Error('name/title already used by ' + dupTitle.sku);

  const data: Prisma.ProductUncheckedCreateInput = {
    sku: SKU, name, description,
    category: parent.category, subcategory: parent.subcategory, leafCategory: parent.leafCategory,
    price, mrp, costPrice: null, taxPercent: parent.taxPercent, discountPercent: parent.discountPercent,
    dimensions: null, power: parent.power, capacity: '2L + 700ml', weight: parent.weight,
    material: parent.material, color: 'Red', freeShipping: parent.freeShipping,
    stock: 0, reorderPoint: parent.reorderPoint, hsnCode: parent.hsnCode,
    status: 'draft', isBestseller: false, isNewArrival: false,
    imageUrl: red.imageUrl, images: (red.images ?? undefined) as Prisma.InputJsonValue | undefined,
    metaTitle, metaDescription, metaKeywords,
  };
  console.log({ ...data, description: `${description.length} ch`, images: `${(red.images as string[] | null)?.length ?? 0} image(s)` });
  if (!apply) { console.log('DRY RUN — re-run with --apply'); return; }

  const created = await prisma.$transaction(async (tx) => {
    const c = await tx.product.create({ data });
    return tx.product.update({ where: { id: c.id }, data: { productCode: `PID-${String(c.id).padStart(5, '0')}` } });
  });
  console.log(`created #${created.id} ${created.sku} (${created.productCode}) · ${created.status} · price ${created.price} mrp ${created.mrp} · stock ${created.stock}`);
})().finally(() => prisma.$disconnect());
