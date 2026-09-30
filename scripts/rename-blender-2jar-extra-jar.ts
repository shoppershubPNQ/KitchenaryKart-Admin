/**
 * KKCE0041-SBL2J, owner 2026-09-30: "Chutney Jar" out of the name — the listing
 * says it comes with an extra 700ml jar. Name, SEO title/meta, keywords and the
 * jar wording in the description follow; chutneys/gravies stay as uses (the
 * owner's poster photo lists them). Photos, price, stock untouched.
 *
 * Usage: npx tsx scripts/rename-blender-2jar-extra-jar.ts [--apply]
 */
import { prisma } from '../lib/db';

const SKU = 'KKCE0041-SBL2J';
const name = 'Electric 2L Commercial Blender 4500W with Extra 700ml Jar - Red - New Model';
const description = [
  'Comes with an extra 700 ml jar alongside the 2 litre jar.',
  '',
  'The Kitchenary Kart Electric 2L Commercial Blender 4500W (New Model) comes with a 2000 ml liquid jar plus an extra 700 ml jar. Use the big jar for juices, smoothies, milkshakes and lassi, and fit the small one for chutneys, gravies and smaller quantities.',
  '',
  'A speed dial runs from low to high, with on/off switches on either side of the panel. The red and black body stands out on juice shop, café and restaurant counters.',
  '',
  'Key Features',
  '',
  '• Extra Jar Included: A 2000 ml liquid jar with handle, plus an extra 700 ml jar.',
  '• 4500W Motor: Runs on 220–240V, 50/60Hz.',
  '• Speed Dial: Low-to-high control for thin juices or thick blends.',
  '• Height: 48 cm with the 2L jar fitted, 34.5 cm with the 700 ml jar.',
  '• Base Size: 17 cm wide and 21 cm long.',
  '• Weight: 2.533 kg with the 2L jar, 2.214 kg with the 700 ml jar.',
  '',
  'Suitable for: Juices, smoothies, milkshakes, chutneys and gravies.',
  '',
  'Care & Use: Fit the jar and lid securely before switching on. Stay below the maximum filling line and follow the recommended running times and rest breaks. Stop the blades before removing a jar. Unplug before cleaning and keep the motor base dry.',
].join('\n');
const metaTitle = '2L Blender with Extra 700ml Jar, Red | Kitchenary Kart';
const metaDescription = 'Kitchenary Kart 4500W commercial blender, new model in red, with a 2L jar plus an extra 700ml jar for juices, shakes, chutneys and gravies.';
const metaKeywords = 'electric, commercial, blender, 4500w, 2l, 700ml, extra jar, two jars, new model, red, juicer, smoothie, cold equipment, commercial blender, restaurant, cafe, juice shop, GST invoice';

(async () => {
  const apply = process.argv.includes('--apply');
  if (metaTitle.length > 60) throw new Error(`title ${metaTitle.length}`);
  if (metaDescription.length > 160) throw new Error(`meta ${metaDescription.length}`);
  if (/chutney jar/i.test([name, description, metaTitle, metaDescription, metaKeywords].join(' '))) throw new Error('"chutney jar" still present');
  const p = await prisma.product.findUniqueOrThrow({ where: { sku: SKU }, select: { id: true, name: true, metaTitle: true } });
  const clash = await prisma.product.findFirst({ where: { id: { not: p.id }, OR: [{ name }, { metaTitle }] }, select: { sku: true } });
  if (clash) throw new Error('name/title already used by ' + clash.sku);
  console.log(`name:  ${p.name}\n    → ${name}\ntitle: ${p.metaTitle}\n    → ${metaTitle} (${metaTitle.length})\nmeta (${metaDescription.length}): ${metaDescription}`);
  if (!apply) { console.log('DRY RUN — re-run with --apply'); return; }
  await prisma.product.update({ where: { id: p.id }, data: { name, description, metaTitle, metaDescription, metaKeywords } });
  const a = await prisma.product.findUniqueOrThrow({ where: { id: p.id }, select: { name: true, metaTitle: true } });
  console.log('saved:', a);
})().finally(() => prisma.$disconnect());
