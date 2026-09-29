/** Read-only check, run after any description work: size pages with NO description of their own
 *  house-format copy — those pages show a SIBLING's text (another size or colour). */
import { prisma } from '../lib/db';
(async () => {
  const parents = await prisma.product.findMany({
    where: { status: 'active', description: { contains: 'Key Features' }, variants: { some: {} } },
    select: { sku: true, name: true, description: true, variants: { select: { skuSuffix: true, variantValue: true, description: true }, orderBy: { id: 'asc' } } },
  });
  let n = 0;
  for (const p of parents) {
    const bare = p.variants.filter((v) => !v.description || !v.description.trim());
    if (!bare.length) continue;
    const donor = p.variants.find((v) => v.description && v.description === p.description);
    n += bare.length;
    console.log(`${p.sku.padEnd(18)} parent text = ${donor ? donor.skuSuffix + ' "' + donor.variantValue + '"' : '(its own)'} · sizes showing it: ${bare.map((v) => `${v.skuSuffix} "${v.variantValue}"`).join(', ')} · ${p.name.slice(0, 50)}`);
  }
  console.log(`\n${n} size page(s) showing a sibling's description`);
  await prisma.$disconnect();
})();
