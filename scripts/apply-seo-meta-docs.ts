/** Apply "SEO Title:" / "Meta Description:" lines from an owner category docx
 *  (extracted text, layout A) to the meta_title / meta_description columns.
 *
 *  Where each goes follows the same rule as the descriptions: a pure variant
 *  SKU writes to the VARIANT row, anything else to the product row. The PDP
 *  reads the variant's first on a variant url, then the parent's on the
 *  parent's own url.
 *
 *  These used to be skipped — meta lived on the product row alone — which left
 *  629 live variant urls unable to carry a written title. Five of the nine
 *  commercial mixers were in that state on 24 Sep 2026.
 *
 *  Usage: npx tsx scripts/apply-seo-meta-docs.ts <doc.txt> [--apply]
 */
import { readFileSync, writeFileSync } from 'fs';
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');
const FILE = process.argv.slice(2).find((a) => !a.startsWith('--'));
/** See apply-description-docs: the brand is two words; the domain is untouched. */
const brand = (t: string) => t.replace(/KitchenaryKart(?!\.com)/g, 'Kitchenary Kart');

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
      const sku = /KK-[A-Z]+-\d+|\b[A-Z]{2,}-[A-Z0-9]+(?:-[A-Z0-9]+)+\b|[A-Z]{2,}[A-Z0-9]*\d+-[A-Za-z0-9./()-]*[A-Za-z0-9)]/.exec(t.slice(4))?.[0] ?? t.slice(4).trim();
      const item: { sku: string; title?: string; desc?: string } = { sku };
      const title = /(?:SEO|Meta) Title:\s*(.+?\|\s*Kitchenary ?Kart)/.exec(t)?.[1];
      const desc = /Meta Description:\s*(.+?)\s*(?:\|\s*\/|\|\s*$|$)/.exec(t)?.[1];
      if (title) item.title = title.trim();
      if (desc) item.desc = desc.trim();
      items.push(item);
    }
    // The popcorn doc labels the title "Meta Title:"; earlier docs say "SEO Title:".
    else if (/^(SEO|Meta) Title:/.test(t) && items.length) items[items.length - 1].title = t.replace(/^(SEO|Meta) Title:/, '').trim();
    else if (t.startsWith('Meta Description:') && items.length) items[items.length - 1].desc = t.slice(17).trim();
  }

  type Change = { sku: string; target: 'variant' | 'product'; id: number; field: 'metaTitle' | 'metaDescription'; from: string | null; to: string };
  const changes: Change[] = [];
  const skipped: string[] = [];
  const tooLong: string[] = [];
  // Two queries for the whole document: one lookup per SKU outlived the Neon
  // connection on the 105-SKU polyrattan document (29 Sep 2026).
  const skuList = items.map((it) => it.sku);
  const productRows = await prisma.product.findMany({ where: { sku: { in: skuList } }, select: { id: true, sku: true, metaTitle: true, metaDescription: true } });
  const variantRows = await prisma.productVariant.findMany({ where: { skuSuffix: { in: skuList } }, select: { id: true, skuSuffix: true, metaTitle: true, metaDescription: true } });

  for (const it of items) {
    if (!it.title || !it.desc) throw new Error(`${it.sku}: missing title or meta description`);
    // Two words (owner, 24 Sep 2026); most documents on file still use the old
    // spelling. Done before the length checks, since it adds a character.
    it.title = brand(it.title);
    it.desc = brand(it.desc);
    if (it.title.length > 60) { tooLong.push(`${it.sku}: title ${it.title.length} — ${it.title}`); continue; }
    if (it.desc.length > 160) { tooLong.push(`${it.sku}: meta ${it.desc.length} — ${it.desc}`); continue; }

    // A parent whose own SKU doubles as its first variant SKU is matched by
    // BOTH lookups. It is written as a product, because the parent url is the
    // one the parent row's meta is read on.
    const p = productRows.find((x) => x.sku === it.sku) ?? null;
    const v = p ? null : variantRows.find((x) => x.skuSuffix === it.sku) ?? null;
    const row = p ?? v;
    if (!row) { skipped.push(`${it.sku} — no product or variant with this SKU`); continue; }
    const target = p ? 'product' : 'variant';
    if (row.metaTitle !== it.title) changes.push({ sku: it.sku, target, id: row.id, field: 'metaTitle', from: row.metaTitle, to: it.title });
    if (row.metaDescription !== it.desc) changes.push({ sku: it.sku, target, id: row.id, field: 'metaDescription', from: row.metaDescription, to: it.desc });
  }

  console.log(`${items.length} items · ${changes.length} field changes · ${skipped.length} skipped`);
  for (const c of changes) console.log(`${c.sku.padEnd(20)} ${c.target.padEnd(8)} ${c.field.padEnd(15)} (${c.to.length}) ${c.to}`);
  if (skipped.length) console.log(`\nskipped:\n  ${skipped.join('\n  ')}`);
  if (tooLong.length) {
    console.log(`\nTOO LONG — nothing written:\n  ${tooLong.join('\n  ')}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  if (APPLY && changes.length) {
    const file = `backup-seo-meta-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    writeFileSync(file, JSON.stringify(changes, null, 2));
    // One transaction: all fields land or none do — a dropped connection half way
    // through a long document can no longer leave it partly applied.
    await prisma.$transaction(changes.map((c) => c.target === 'product'
      ? prisma.product.update({ where: { id: c.id }, data: { [c.field]: c.to } })
      : prisma.productVariant.update({ where: { id: c.id }, data: { [c.field]: c.to } })));
    const pIds = changes.filter((c) => c.target === 'product').map((c) => c.id);
    const vIds = changes.filter((c) => c.target === 'variant').map((c) => c.id);
    const after = new Map<string, { metaTitle: string | null; metaDescription: string | null }>();
    for (const r of await prisma.product.findMany({ where: { id: { in: pIds } }, select: { id: true, metaTitle: true, metaDescription: true } })) after.set(`product:${r.id}`, r);
    for (const r of await prisma.productVariant.findMany({ where: { id: { in: vIds } }, select: { id: true, metaTitle: true, metaDescription: true } })) after.set(`variant:${r.id}`, r);
    let ok = 0;
    for (const c of changes) if (after.get(`${c.target}:${c.id}`)?.[c.field] === c.to) ok++;
    console.log(`\nbackup: ${file} · verified ${ok}/${changes.length}`);
  } else if (!APPLY) console.log('\nDRY RUN — re-run with --apply');
  await prisma.$disconnect();
})();
