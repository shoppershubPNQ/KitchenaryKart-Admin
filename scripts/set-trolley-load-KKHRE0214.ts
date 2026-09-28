/** KKHRE0214-RE2LETST: 200 kg load capacity (owner, 28 Sep 2026).
 *
 *  The SS 2 layer service trolley's copy had one feature bullet and a Care &
 *  Use line pointing at "limits specified for the model" without specifying
 *  any. The owner gave the figure: it bears 200 kg. Also replaces the meta
 *  description, which was cut mid-word at 160 ("…professional ho").
 *
 *  Usage: npx tsx scripts/set-trolley-load-KKHRE0214.ts [--apply]
 */
import { writeFileSync } from 'fs';
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');
const SKU = 'KKHRE0214-RE2LETST';

const BULLET_AFTER = '• 2-Layer Format: Two levels provide practical separation for items during transport and service.';
const BULLET_NEW = '• 200 kg Load Capacity: Built to carry up to 200 kg.';
const CARE_FROM = 'do not exceed the trolley or component limits specified for the model';
const CARE_TO = 'do not exceed the 200 kg load capacity';
const META =
  'SS rectangle 2 layer service trolley with extra-depth trays and a 200 kg load capacity, for moving crockery and supplies in hotels, restaurants and catering.';

(async () => {
  if (META.length > 160) throw new Error(`meta ${META.length} > 160`);
  const p = await prisma.product.findUnique({ where: { sku: SKU }, select: { id: true, description: true, metaDescription: true } });
  if (!p?.description) throw new Error(`${SKU} not found or has no description`);
  if (p.description.includes('200 kg')) { console.log('already has 200 kg'); await prisma.$disconnect(); return; }
  if (!p.description.includes(BULLET_AFTER)) throw new Error('feature bullet not found — description changed since this was written');
  if (!p.description.includes(CARE_FROM)) throw new Error('care line not found — description changed since this was written');

  const description = p.description.replace(BULLET_AFTER, `${BULLET_AFTER}\n${BULLET_NEW}`).replace(CARE_FROM, CARE_TO);
  console.log(description);
  console.log(`\nmeta (${META.length}): ${META}\nwas: ${p.metaDescription}`);

  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply'); await prisma.$disconnect(); return; }
  writeFileSync(`backup-${SKU}-load-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(p, null, 2));
  await prisma.product.update({ where: { id: p.id }, data: { description, metaDescription: META } });
  const after = await prisma.product.findUnique({ where: { id: p.id }, select: { description: true, metaDescription: true } });
  console.log(after?.description === description && after?.metaDescription === META ? '\nwritten · verified' : '\nNOT VERIFIED');
  await prisma.$disconnect();
})();
