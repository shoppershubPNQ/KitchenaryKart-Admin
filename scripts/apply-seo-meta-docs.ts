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
  /**
   * Some documents label the two as HEADINGS with the value on the next
   * paragraph — "[Heading2] SEO Title" then the title — rather than as
   * "SEO Title: …" on one line. `expecting` carries that heading forward to
   * the line that follows it.
   */
  let expecting: 'title' | 'desc' | null = null;

  for (const raw of readFileSync(FILE, 'utf8').split(/\r?\n/)) {
    const isHeading = /^\[[^\]]*Heading\d/.test(raw);
    const t = raw.replace(/^\[[^\]]*\]\s?/, '').trim();

    if (isHeading && /^SEO Title$/i.test(t)) { expecting = 'title'; continue; }
    if (isHeading && /^Meta Description$/i.test(t)) { expecting = 'desc'; continue; }
    if (expecting) {
      // A blank line or another heading means the value never came.
      if (t && !isHeading && items.length) {
        items[items.length - 1][expecting] = t;
        expecting = null;
        continue;
      }
      if (isHeading) expecting = null;
    }

    if (t.startsWith('SKU:')) {
      // The SKU can share a table cell with SEO Title and Meta (deep fryer
      // doc): "SKU: X / Source product listing / SEO Title: T | KitchenaryKart
      // / Meta Description: M | / Supplied product photograph."
      // Brackets and a slash belong to some SKUs — see apply-description-docs.
      const sku = /KK-[A-Z]+-\d+|[A-Z]{2,}[A-Z0-9]*\d+-[A-Z0-9./()]*[A-Z0-9)]/.exec(t.slice(4))?.[0] ?? t.slice(4).trim();
      const item: { sku: string; title?: string; desc?: string } = { sku };
      const title = /(?:SEO|Meta) Title:\s*(.+?\|\s*KitchenaryKart)/.exec(t)?.[1];
      const desc = /Meta Description:\s*(.+?)\s*(?:\|\s*\/|\|\s*$|$)/.exec(t)?.[1];
      if (title) item.title = title.trim();
      if (desc) item.desc = desc.trim();
      items.push(item);
    }
    // The popcorn doc labels the title "Meta Title:"; earlier docs say "SEO Title:".
    else if (/^(SEO|Meta) Title:/.test(t) && items.length) items[items.length - 1].title = t.replace(/^(SEO|Meta) Title:/, '').trim();
    else if (t.startsWith('Meta Description:') && items.length) items[items.length - 1].desc = t.slice(17).trim();
  }

  const changes: Array<{ sku: string; field: 'metaTitle' | 'metaDescription'; from: string | null; to: string }> = [];
  const skipped: string[] = [];
  const tooLong: string[] = [];
  for (const it of items) {
    if (!it.title || !it.desc) throw new Error(`${it.sku}: missing title or meta description`);
    if (it.title.length > 60) { tooLong.push(`${it.sku}: title ${it.title.length} — ${it.title}`); continue; }
    if (it.desc.length > 160) { tooLong.push(`${it.sku}: meta ${it.desc.length} — ${it.desc}`); continue; }
    const p = await prisma.product.findUnique({ where: { sku: it.sku }, select: { metaTitle: true, metaDescription: true } });
    if (!p) { skipped.push(`${it.sku} — variant-only url, meta applies to parent url only`); continue; }
    if (p.metaTitle !== it.title) changes.push({ sku: it.sku, field: 'metaTitle', from: p.metaTitle, to: it.title });
    if (p.metaDescription !== it.desc) changes.push({ sku: it.sku, field: 'metaDescription', from: p.metaDescription, to: it.desc });
  }

  console.log(`${items.length} items · ${changes.length} field changes · ${skipped.length} skipped`);
  for (const c of changes) console.log(`${c.sku.padEnd(20)} ${c.field.padEnd(15)} (${c.to.length}) ${c.to}`);
  if (skipped.length) console.log(`\nskipped:\n  ${skipped.join('\n  ')}`);
  if (tooLong.length) {
    console.log(`\nTOO LONG — nothing written:\n  ${tooLong.join('\n  ')}`);
    await prisma.$disconnect();
    process.exit(1);
  }

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
