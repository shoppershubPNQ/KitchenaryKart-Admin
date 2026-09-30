/** READ-ONLY. Owner rule 30 Sep 2026: other companies' brand names must never
 *  appear in product copy (only the house brands VAMA and Veratti, which are
 *  ours). Scans descriptions + SEO text of products and size options.
 *  Usage: npx tsx scripts/audit-other-brands.ts
 */
import { prisma } from '../lib/db';

const BRANDS = ['Honest', 'Burnomatic', 'Minimax', 'Honeyson', 'Marado', 'Zwilling', 'Farberware', 'Millionparcel', 'Brasaovens', 'Ansemy', 'KTJ', 'Parkoo', 'Lensoul', 'Cntronic', 'Citronic', 'Clatronic', 'Zapata',
  'Prestige', 'Hawkins', 'Pigeon', 'Philips', 'Bosch', 'Borosil', 'Milton', 'Cello', 'Tupperware', 'Wonderchef', 'Bajaj', 'Usha', 'Havells', 'Morphy Richards',
  'Kenstar', 'Inalsa', 'Preethi', 'Sujata', 'Maharaja', 'Kent', 'Kitchenaid', 'KitchenAid', 'Nestle', 'Hamilton', 'Victorinox', 'Wusthof', 'Henckels',
  'Tefal', 'Vinod', 'Meyer', 'Signoraware', 'Solimo', 'AmazonBasics', 'Ikea', 'IKEA', 'Oxo', 'OXO', 'Weber', 'Winco', 'Vollrath', 'Cambro', 'Rubbermaid', 'Hobart', 'Robot Coupe', 'Waring', 'Vitamix', 'Blendtec', 'Nutribullet'];
const re = new RegExp(`\\b(${BRANDS.map((b) => b.replace(/ /g, '\\s+')).join('|')})\\b`, 'i');

(async () => {
  const ps = await prisma.product.findMany({ select: { sku: true, name: true, description: true, metaTitle: true, metaDescription: true } });
  const vs = await prisma.productVariant.findMany({ select: { skuSuffix: true, description: true, metaTitle: true, metaDescription: true } });
  const hits: string[] = [];
  for (const p of ps) for (const f of ['name', 'description', 'metaTitle', 'metaDescription'] as const) {
    const m = re.exec(p[f] ?? ''); if (m) hits.push(`P ${p.sku} ${f}: "${m[0]}" — ${(p[f] ?? '').slice(Math.max(0, m.index - 40), m.index + 40).replace(/\n/g, ' ')}`);
  }
  for (const v of vs) for (const f of ['description', 'metaTitle', 'metaDescription'] as const) {
    const m = re.exec(v[f] ?? ''); if (m) hits.push(`V ${v.skuSuffix} ${f}: "${m[0]}" — ${(v[f] ?? '').slice(Math.max(0, m.index - 40), m.index + 40).replace(/\n/g, ' ')}`);
  }
  console.log(`scanned ${ps.length} products + ${vs.length} size options · other-brand mentions: ${hits.length}`);
  for (const h of hits) console.log('  ' + h);
})().finally(() => prisma.$disconnect());
