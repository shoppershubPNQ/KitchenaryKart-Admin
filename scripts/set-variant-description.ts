/** Put an owner-supplied description on ONE variant (size) row.
 *  Each size has its own features, so size-specific text goes on the variant,
 *  never the parent (the other sizes' pages would claim its specs).
 *  Backs up the variant first; dry run unless --apply; busts the live
 *  storefront product cache after applying.
 *  Usage: npx tsx --env-file=.env scripts/set-variant-description.ts <VARIANT_SKU> <text-file> [--keep-lines] [--apply]
 *
 *  By default all whitespace collapses to single spaces — right for one pasted
 *  paragraph. --keep-lines keeps line and paragraph breaks instead: the PDP
 *  renders the description with whitespace-pre-line, so headings ("Key
 *  Features") and "•" bullets only survive as structure if the newlines do.
 *  Collapsing them turned a formatted description into one run-on line. */
import * as fs from 'fs';
import { prisma } from '../lib/db';

const [SKU, FILE] = process.argv.slice(2);
const APPLY = process.argv.includes('--apply');
const KEEP_LINES = process.argv.includes('--keep-lines');

(async () => {
  if (!SKU || !FILE) { console.log('usage: <VARIANT_SKU> <text-file> [--keep-lines] [--apply]'); return; }
  const raw = fs.readFileSync(FILE, 'utf8');
  const text = KEEP_LINES
    ? raw
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n') // at most one blank line between blocks
        .trim()
    : raw.replace(/\s+/g, ' ').trim();
  if (KEEP_LINES) console.log(`keeping line breaks: ${text.split('\n').length} lines`);
  const v = await prisma.productVariant.findFirst({
    where: { skuSuffix: SKU },
    select: { id: true, skuSuffix: true, variantValue: true, capacity: true, power: true, description: true, product: { select: { sku: true, name: true } } },
  });
  if (!v) { console.log(`STOP: ${SKU} is not a variant SKU — nothing changed`); return; }
  console.log(`variant id=${v.id} ${v.skuSuffix} "${v.variantValue}" ${v.capacity ?? ''} ${v.power ?? ''} — ${v.product.name} (parent ${v.product.sku})`);
  console.log(`current: ${v.description ? v.description.slice(0, 90) + '…' : '(none — page shows the parent description)'}`);
  console.log(`new: ${text.length} chars: ${text.slice(0, 90)}…${APPLY ? '' : '  [DRY RUN]'}`);
  if (!APPLY) return;
  const backup = `backup-variant-description-${SKU.replace(/[^A-Za-z0-9-]/g, '_')}-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(backup, JSON.stringify(v, null, 2));
  await prisma.productVariant.update({ where: { id: v.id }, data: { description: text } });
  const after = await prisma.productVariant.findUnique({ where: { id: v.id }, select: { description: true } });
  console.log(`saved: ${after?.description === text ? 'YES, exact text' : 'MISMATCH'} (backup ${backup})`);
  const res = await fetch('https://kitchenarykart.com/api/revalidate?tag=products', { method: 'POST' }).catch(() => null);
  console.log(`live product cache refresh: ${res ? res.status : 'failed'}`);
  await prisma.$disconnect();
})();
