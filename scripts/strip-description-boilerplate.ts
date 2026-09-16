/**
 * Remove the trailing GST / delivery / WhatsApp boilerplate from product
 * descriptions.
 *
 *   npx tsx scripts/strip-description-boilerplate.ts [--apply]
 *
 * The block was appended to 1,362 descriptions during the SEO sprint. It exists
 * in 114 near-identical forms — they differ only in the GST% and HSN quoted
 * inside the brackets — and a probe confirmed it is ALWAYS the tail of the
 * text, never followed by real content. So the rule is simply: cut from the
 * first "Every order ships" to the end.
 *
 * Safety: writes a full backup of every description it touches, and refuses to
 * blank a product — if cutting leaves almost nothing, that row is skipped and
 * reported rather than emptied.
 */
import { writeFileSync } from 'fs';
import { prisma } from '../lib/db';

const CUT_FROM = 'Every order ships';
const MIN_KEEP = 40;

(async () => {
  const apply = process.argv.includes('--apply');
  const rows = await prisma.product.findMany({
    where: { description: { contains: CUT_FROM } },
    select: { id: true, sku: true, description: true },
  });

  const edits: Array<{ id: number; sku: string; before: string; after: string }> = [];
  const tooShort: string[] = [];

  for (const r of rows) {
    const before = r.description ?? '';
    const i = before.indexOf(CUT_FROM);
    if (i < 0) continue;
    const after = before.slice(0, i).replace(/\s+$/, '');
    if (after.trim().length < MIN_KEEP) { tooShort.push(r.sku); continue; }
    edits.push({ id: r.id, sku: r.sku, before, after });
  }

  console.log(`${rows.length} description(s) carry the block; ${edits.length} will be trimmed; ${tooShort.length} skipped as too short.`);
  if (tooShort.length) console.log('skipped:', tooShort.join(', '));

  const sample = edits[0];
  if (sample) {
    console.log(`\n--- sample ${sample.sku} ---`);
    console.log('BEFORE (last 300):', JSON.stringify(sample.before.slice(-300)));
    console.log('AFTER  (last 300):', JSON.stringify(sample.after.slice(-300)));
  }

  if (!apply) { console.log('\nDry run. Re-run with --apply to write.'); await prisma.$disconnect(); return; }

  const backup = `backup-description-boilerplate-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(backup, JSON.stringify(edits.map((e) => ({ sku: e.sku, description: e.before })), null, 1));
  console.log(`\nFull previous descriptions saved to ${backup}`);

  let done = 0;
  for (const e of edits) {
    await prisma.product.update({ where: { id: e.id }, data: { description: e.after } });
    if (++done % 200 === 0) console.log(`  ${done}/${edits.length}`);
  }

  const left = await prisma.product.count({ where: { description: { contains: CUT_FROM } } });
  console.log(`\nUpdated ${done}. Descriptions still containing the block: ${left} (expected ${tooShort.length}).`);
  await prisma.$disconnect();
})();
