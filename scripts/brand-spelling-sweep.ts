/** One brand spelling everywhere: "KitchenaryKart" → "Kitchenary Kart".
 *
 *  The owner's ruling (24 Sep 2026) is that the consumer brand is two words.
 *  Both spellings were in use — titles, meta descriptions, descriptions and
 *  blog copy written at different times — which splits brand signals and reads
 *  as two different shops.
 *
 *  The domain stays kitchenarykart.com: that is an address, not the name, and
 *  it is lowercase, so nothing here touches it.
 *
 *  Meta titles get one character longer. Any that would pass 60 characters are
 *  reported and left alone rather than silently pushed past what Google shows.
 *
 *  Usage: npx tsx scripts/brand-spelling-sweep.ts [--apply]
 */
import { writeFileSync } from 'fs';
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');
const OLD = /KitchenaryKart/g;
const NEW = 'Kitchenary Kart';

type Change = { table: string; id: number; field: string; old: string; next: string };

const changes: Change[] = [];
const skipped: string[] = [];

function consider(table: string, id: number, field: string, value: string | null, limit?: number) {
  if (!value || !OLD.test(value)) return;
  OLD.lastIndex = 0;
  const next = value.replace(OLD, NEW);
  if (limit && next.length > limit) {
    skipped.push(`${table} #${id} ${field}: would be ${next.length} > ${limit} — ${next}`);
    return;
  }
  changes.push({ table, id, field, old: value, next });
}

(async () => {
  const products = await prisma.product.findMany({
    select: { id: true, sku: true, name: true, description: true, metaTitle: true, metaDescription: true },
  });
  for (const p of products) {
    consider('product', p.id, 'name', p.name);
    consider('product', p.id, 'description', p.description);
    consider('product', p.id, 'metaTitle', p.metaTitle, 60);
    consider('product', p.id, 'metaDescription', p.metaDescription, 160);
  }

  const variants = await prisma.productVariant.findMany({ select: { id: true, description: true } });
  for (const v of variants) consider('productVariant', v.id, 'description', v.description);

  const byField = new Map<string, number>();
  for (const c of changes) byField.set(`${c.table}.${c.field}`, (byField.get(`${c.table}.${c.field}`) ?? 0) + 1);
  console.log(`${changes.length} row-fields to change`);
  for (const [k, n] of byField) console.log(`  ${k.padEnd(32)} ${n}`);
  if (skipped.length) console.log(`\n${skipped.length} left alone (would overflow):\n  ${skipped.join('\n  ')}`);

  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply');
    await prisma.$disconnect();
    return;
  }

  const file = `backup-brand-spelling-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  writeFileSync(file, JSON.stringify(changes, null, 2));
  for (const c of changes) {
    if (c.table === 'product') await prisma.product.update({ where: { id: c.id }, data: { [c.field]: c.next } });
    else await prisma.productVariant.update({ where: { id: c.id }, data: { [c.field]: c.next } });
  }
  const left = await prisma.product.count({
    where: { OR: [{ name: { contains: 'KitchenaryKart' } }, { description: { contains: 'KitchenaryKart' } }, { metaTitle: { contains: 'KitchenaryKart' } }, { metaDescription: { contains: 'KitchenaryKart' } }] },
  });
  console.log(`\nbackup: ${file} · ${changes.length} written · ${left} product rows still carry the old spelling (expected ${skipped.length})`);
  await prisma.$disconnect();
})();
