/** Owner 30 Sep 2026: "Silicon" is the store's spelling — material fields that
 *  read "Silicone…" follow (they show on product cards and the spec table).
 *  Usage: npx tsx scripts/fix-material-silicon.ts [--apply]
 */
import { writeFileSync } from 'fs';
import { prisma } from '../lib/db';

(async () => {
  const rows = await prisma.product.findMany({ where: { material: { contains: 'ilicone' } }, select: { id: true, sku: true, material: true } });
  for (const r of rows) console.log(`${r.sku.padEnd(18)} ${r.material} → ${r.material!.replace(/Silicone/g, 'Silicon').replace(/silicone/g, 'silicon')}`);
  if (!process.argv.includes('--apply')) { console.log(`${rows.length} row(s). DRY RUN — re-run with --apply`); return; }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  writeFileSync(`backup-material-silicon-${stamp}.json`, JSON.stringify(rows, null, 2));
  await prisma.$transaction(rows.map((r) => prisma.product.update({ where: { id: r.id }, data: { material: r.material!.replace(/Silicone/g, 'Silicon').replace(/silicone/g, 'silicon') } })));
  console.log(`${rows.length} written · backup backup-material-silicon-${stamp}.json`);
})().finally(() => prisma.$disconnect());
