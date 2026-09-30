/**
 * KKCE0041-SBL2J (new-model 4500W Red blender, 2L + 700ml jars), owner 2026-09-30:
 *   - replace the old one-jar photos (copied at creation) with the owner's four
 *     photos of this model — "Citronic PNQ" heading and the Gemini sparkle
 *     already removed from them at the owner's request;
 *   - rewrite name / description / dimensions / SEO from those photos: 2000ml
 *     liquid jar + 700ml chutney jar, 4500W 220–240V 50/60Hz, low-to-high speed
 *     dial, 48cm (2L jar) / 34.5cm (700ml jar) tall, 17 x 21cm base, 2.533kg /
 *     2.214kg. Juices, smoothies, chutneys and gravies are the photo's own uses.
 * Stays a draft; price untouched (HE 3,250 → 4,985.50).
 *
 * Usage: npx tsx scripts/update-blender-2jar-listing.ts <dir with blender-1..4 .webp> [--apply]
 */
import { readFileSync } from 'fs';
import path from 'path';
import { prisma } from '../lib/db';

function envFromFile(key: string): string {
  for (const f of ['.env.local', '.env']) {
    try {
      const line = readFileSync(f, 'utf8').split(/\r?\n/).find((l) => l.startsWith(key + '='));
      if (line) return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
    } catch { /* try the next file */ }
  }
  return '';
}
process.env.CLOUDINARY_URL ||= envFromFile('CLOUDINARY_URL');

const SKU = 'KKCE0041-SBL2J';
const FILES = ['blender-1-main.webp', 'blender-2-dimensions.webp', 'blender-3-label.webp', 'blender-4-poster.webp'];

const name = 'Electric 2L Commercial Blender 4500W with 700ml Chutney Jar - Red - New Model';
const description = [
  'One motor base, two jars — the big one for drinks, the small one for chutneys.',
  '',
  'The Kitchenary Kart Electric 2L Commercial Blender 4500W (New Model) comes with a 2000 ml liquid jar and a 700 ml chutney jar. Use the big jar for juices, smoothies, milkshakes and lassi, and fit the small one for chutneys and gravies.',
  '',
  'A speed dial runs from low to high, with on/off switches on either side of the panel. The red and black body stands out on juice shop, café and restaurant counters.',
  '',
  'Key Features',
  '',
  '• Two Jars Included: A 2000 ml liquid jar with handle and a 700 ml chutney jar.',
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
const dimensions = '17cm (W) x 21cm (D) x 48cm (H)';
const metaTitle = '2L Blender with 700ml Chutney Jar, Red | Kitchenary Kart';
const metaDescription = 'Kitchenary Kart 4500W commercial blender, new model in red, with a 2L jar for juices and shakes and a 700ml jar for chutneys and gravies.';
const metaKeywords = 'electric, commercial, blender, 4500w, 2l, 700ml, chutney jar, two jars, new model, red, juicer, smoothie, cold equipment, commercial blender, restaurant, cafe, juice shop, GST invoice';

(async () => {
  const [dir] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const apply = process.argv.includes('--apply');
  if (!dir) throw new Error('usage: update-blender-2jar-listing.ts <dir> [--apply]');
  if (metaTitle.length > 60) throw new Error(`title ${metaTitle.length}`);
  if (metaDescription.length > 160) throw new Error(`meta ${metaDescription.length}`);

  const p = await prisma.product.findUniqueOrThrow({ where: { sku: SKU }, select: { id: true, status: true, images: true, name: true } });
  if (p.status !== 'draft') throw new Error(`${SKU} is ${p.status}, expected draft`);
  const bufs = FILES.map((f) => readFileSync(path.join(dir, f)));
  console.log(`${SKU} #${p.id}: ${(p.images as string[] | null)?.length ?? 0} old photo(s) → ${bufs.length} new (${bufs.map((b) => `${(b.length / 1024).toFixed(0)}KB`).join(', ')})`);
  console.log(`name: ${p.name} → ${name}\ntitle (${metaTitle.length}): ${metaTitle}\nmeta (${metaDescription.length}): ${metaDescription}\ndimensions: ${dimensions}\n\n${description}`);
  if (!apply) { console.log('\nDRY RUN — re-run with --apply'); return; }

  const { uploadBuffer } = await import('../lib/cloudinary-upload');
  const urls: string[] = [];
  for (const b of bufs) urls.push((await uploadBuffer(b, { folder: `kk/${SKU}`, resourceType: 'image' })).url);
  const saved = await prisma.product.update({
    where: { id: p.id },
    data: { name, description, dimensions, metaTitle, metaDescription, metaKeywords, images: urls, imageUrl: urls[0] },
    select: { imageUrl: true, images: true, name: true, status: true },
  });
  console.log('\nsaved:', JSON.stringify(saved, null, 2));
})().finally(() => prisma.$disconnect());
