/** Apply "SEO Title:" / "Meta Description:" lines from an owner category docx
 *  (extracted text, layout A) to products.meta_title / meta_description.
 *
 *  The PDP honours these on the PARENT url only (requestedSku === product.sku),
 *  so a SKU gets them only if a product row has exactly that SKU — which
 *  includes a parent whose own SKU doubles as its first variant. Pure variant
 *  SKUs are reported and skipped.
 *
 *  Usage: npx tsx scripts/apply-seo-meta-docs.ts <doc.txt> [--apply]
 */
import { readFileSync, writeFileSync } from 'fs';
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');
const FILE = process.argv.slice(2).find((a) => !a.startsWith('--'));

(async () => {
  if (!FILE) throw new Error('usage: apply-seo-meta-docs.ts <doc.txt> [--apply]');
  const items: Array<{ sku: string; title?: string; desc?: string }> = [];
  for (const raw of readFileSync(FILE, 'utf8').split(/\r?\n/)) {
    const t = raw.replace(/^\[[^\]]*\]\s?/, '').trim();
    if (t.startsWith('SKU:')) items.push({ sku: t.slice(4).trim() });
    else if (t.startsWith('SEO Title:') && items.length) items[items.length - 1].title = t.slice(10).trim();
    else if (t.startsWith('Meta Description:') && items.length) items[items.length - 1].desc = t.slice(17).trim();
  }

  const changes: Array<{ sku: string; field: 'metaTitle' | 'metaDescription'; from: string | null; to: string }> = [];
  const skipped: string[] = [];
  for (const it of items) {
    if (!it.title || !it.desc) throw new Error(`${it.sku}: missing title or meta description`);
    if (it.title.length > 60) throw new Error(`${it.sku}: title ${it.title.length} chars`);
    if (it.desc.length > 160) throw new Error(`${it.sku}: meta description ${it.desc.length} chars`);
    const p = await prisma.product.findUnique({ where: { sku: it.sku }, select: { metaTitle: true, metaDescription: true } });
    if (!p) { skipped.push(`${it.sku} — variant-only url, meta applies to parent url only`); continue; }
    if (p.metaTitle !== it.title) changes.push({ sku: it.sku, field: 'metaTitle', from: p.metaTitle, to: it.title });
    if (p.metaDescription !== it.desc) changes.push({ sku: it.sku, field: 'metaDescription', from: p.metaDescription, to: it.desc });
  }

  console.log(`${items.length} items · ${changes.length} field changes · ${skipped.length} skipped`);
  for (const c of changes) console.log(`${c.sku.padEnd(20)} ${c.field.padEnd(15)} (${c.to.length}) ${c.to}`);
  if (skipped.length) console.log(`\nskipped:\n  ${skipped.join('\n  ')}`);

  if (APPLY && changes.length) {
    const file = `backup-seo-meta-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    writeFileSync(file, JSON.stringify(changes, null, 2));
    for (const c of changes) await prisma.product.update({ where: { sku: c.sku }, data: { [c.field]: c.to } });
    let ok = 0;
    for (const c of changes) {
      const r = await prisma.product.findUnique({ where: { sku: c.sku }, select: { metaTitle: true, metaDescription: true } });
      if (r?.[c.field] === c.to) ok++;
    }
    console.log(`\nbackup: ${file} · verified ${ok}/${changes.length}`);
  } else if (!APPLY) console.log('\nDRY RUN — re-run with --apply');
  await prisma.$disconnect();
})();
