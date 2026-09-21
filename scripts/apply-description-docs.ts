/** Apply product descriptions from the owner's category .docx files.
 *
 *  Input is the text the docx extractor produces (one line per paragraph,
 *  prefixed with its Word style: "[Heading1] …", "[ListBullet,b] …", "[] …").
 *  Two layouts are understood:
 *
 *   A (Bain Marie, BBQ):  Heading1 "NN Name" · "SKU: …" · SEO Title / Meta
 *      Description · Heading2 "Product Description" · paragraphs · Heading2
 *      "Key Features" · ListBullet lines · "Suitable for: …" · "Care & Use: …"
 *   B (Toaster, Choco Warmer, Fountain):  Heading1 "N. Name — SKU" ·
 *      Heading2 "Product Description" · paragraphs · Heading2 "Key Features" ·
 *      "• …" paragraphs · Heading2 "Suitable for:" + paragraph · Heading2
 *      "Care & Use:" + paragraph · closing Heading1 "SEO Keywords" (ignored)
 *
 *  Only the DESCRIPTION is written — SEO titles, meta descriptions and keyword
 *  lists in the docs are left alone.
 *
 *  Where each goes: if the SKU is a variant suffix, the VARIANT row (the PDP
 *  shows the variant's text for that url, and 350/353 parents carry their own
 *  SKU as a variant SKU); otherwise the product row.
 *
 *  Usage: npx tsx scripts/apply-description-docs.ts <doc.txt> [more.txt…] [--apply]
 *  Dry run by default; --apply writes one backup of every old value first.
 */
import { readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');
const FILES = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// Mirrors web/components/ProductDescription.tsx, to report labels that would
// not render bold.
const LABEL = /^([A-Z0-9][A-Za-z0-9 &/'’.-]{1,30}):\s+(.+)$/;
const BULLET_LABEL = /^([A-Z0-9][A-Za-z0-9 &/'’.-]{1,40}):\s+(.+)$/;

type Section = { file: string; sku: string; title: string; body: string[] };

function parse(file: string): Section[] {
  const out: Section[] = [];
  let cur: (Section & { inDesc: boolean; pendingLabel: string }) | null = null;
  const flush = () => { if (cur?.sku) out.push({ file: cur.file, sku: cur.sku, title: cur.title, body: cur.body }); cur = null; };

  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\[([^\]]*)\]\s?(.*)$/.exec(raw);
    if (!m) continue;
    const tags = m[1].split(',');
    const text = m[2].trim();
    if (!text) continue;

    if (tags.includes('Heading1')) {
      flush();
      const b = /^\d+\.?\s+(.+?)\s+—\s+([A-Z]{2,}[A-Z0-9]*\d+-[A-Z0-9.-]+)$/.exec(text); // layout B
      // Layout A: any heading may start a product (numbered or not — the
      // cotton candy doc has no numbers). It only counts once a "SKU:" line
      // follows; "SEO Keywords", "Research notes"… never get one and drop out.
      if (b) cur = { file, sku: b[2], title: b[1], body: [], inDesc: false, pendingLabel: '' };
      else cur = { file, sku: '', title: text.replace(/^\d+\.?\s+/, ''), body: [], inDesc: false, pendingLabel: '' };
      continue;
    }
    if (!cur) continue;
    if (text.startsWith('SKU:')) { cur.sku = text.slice(4).trim(); continue; }
    if (tags.includes('Heading2')) {
      if (text === 'Product Description') { cur.inDesc = true; continue; }
      if (!cur.inDesc) continue;
      if (/^(Suitable for|Care & Use):$/.test(text)) { cur.pendingLabel = text; continue; } // layout B
      cur.body.push(`H:${text}`);
      continue;
    }
    if (!cur.inDesc) continue; // skips "Source product listing", SEO Title, Meta Description
    if (cur.pendingLabel) { cur.body.push(`P:${cur.pendingLabel} ${text}`); cur.pendingLabel = ''; continue; }
    if (tags.includes('ListBullet')) { cur.body.push(`B:${text}`); continue; }
    if (/^[•*]\s+/.test(text)) { cur.body.push(`B:${text.replace(/^[•*]\s+/, '')}`); continue; }
    cur.body.push(`P:${text}`);
  }
  flush();
  return out;
}

/** House format: blank line between blocks, consecutive bullets as "• " lines. */
function build(body: string[]): string {
  let s = '';
  body.forEach((line, i) => {
    const kind = line.slice(0, 2);
    const t = line.slice(2);
    if (kind === 'B:') s += (i > 0 && body[i - 1].startsWith('B:') ? '\n' : s ? '\n\n' : '') + `• ${t}`;
    else s += (s ? '\n\n' : '') + t;
  });
  return s;
}

(async () => {
  if (!FILES.length) throw new Error('usage: apply-description-docs.ts <doc.txt>… [--apply]');
  const sections = FILES.flatMap(parse);
  const seen = new Set<string>();
  for (const s of sections) {
    if (seen.has(s.sku)) throw new Error(`SKU ${s.sku} appears twice`);
    seen.add(s.sku);
  }

  const plan: Array<{ file: string; sku: string; target: 'variant' | 'product'; id: number; old: string | null; text: string }> = [];
  const problems: string[] = [];

  for (const s of sections) {
    const text = build(s.body);
    const lines = text.split('\n');
    const bullets = lines.filter((l) => l.startsWith('• '));
    const unbold = bullets.map((l) => l.slice(2)).filter((l) => !BULLET_LABEL.test(l)).map((l) => l.split(':')[0]);
    const leaks = ['SKU:', 'SEO Title', 'Meta Description', 'Source product listing', 'Product Description', 'SEO Keywords']
      .filter((w) => text.includes(w));
    const hasSuitable = lines.some((l) => l.startsWith('Suitable for: ') && LABEL.test(l));
    const hasCare = lines.some((l) => l.startsWith('Care & Use: ') && LABEL.test(l));

    const v = await prisma.productVariant.findFirst({ where: { skuSuffix: s.sku }, select: { id: true, description: true } });
    const p = v ? null : await prisma.product.findUnique({
      where: { sku: s.sku }, select: { id: true, description: true, status: true, _count: { select: { variants: true } } },
    });
    const where = v ? `variant #${v.id}` : p ? `product #${p.id}${p._count.variants ? ` (HAS ${p._count.variants} variants!)` : ''}` : 'NOT FOUND';

    const flags = [
      bullets.length < 3 ? `only ${bullets.length} bullets` : '',
      !hasSuitable ? 'no Suitable for' : '',
      !hasCare ? 'no Care & Use' : '',
      leaks.length ? `LEAK ${leaks.join('/')}` : '',
      !v && !p ? 'NOT FOUND' : '',
      p && p._count.variants ? 'parent with variants, no matching variant' : '',
    ].filter(Boolean);
    if (flags.length) problems.push(`${s.sku}: ${flags.join(', ')}`);

    console.log(`${basename(s.file).padEnd(28)} ${s.sku.padEnd(20)} → ${where.padEnd(12)} ${String((v ?? p)?.description?.length ?? 0).padStart(5)} → ${String(text.length).padStart(4)} ch · ${bullets.length} bullets`
      + (unbold.length ? `  not-bold: ${unbold.join(' | ')}` : '') + (flags.length ? `  ⚠ ${flags.join(', ')}` : ''));

    if (v) plan.push({ file: s.file, sku: s.sku, target: 'variant', id: v.id, old: v.description, text });
    else if (p) plan.push({ file: s.file, sku: s.sku, target: 'product', id: p.id, old: p.description, text });
  }

  console.log(`\n${sections.length} sections · ${plan.length} matched`);
  const sample = plan[0];
  if (sample) console.log(`\n--- sample: ${sample.sku} ---\n${sample.text}\n---`);

  if (problems.length) {
    console.error(`\n${problems.length} problem(s) — nothing written:\n  ${problems.join('\n  ')}`);
    process.exitCode = 1;
  } else if (APPLY) {
    const file = `backup-descriptions-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    writeFileSync(file, JSON.stringify(plan.map(({ sku, target, id, old }) => ({ sku, target, id, old })), null, 2));
    for (const x of plan) {
      if (x.target === 'variant') await prisma.productVariant.update({ where: { id: x.id }, data: { description: x.text } });
      else await prisma.product.update({ where: { id: x.id }, data: { description: x.text } });
    }
    let ok = 0;
    for (const x of plan) {
      const row = x.target === 'variant'
        ? await prisma.productVariant.findUnique({ where: { id: x.id }, select: { description: true } })
        : await prisma.product.findUnique({ where: { id: x.id }, select: { description: true } });
      if (row?.description === x.text) ok++;
    }
    console.log(`\nbackup: ${file} · verified ${ok}/${plan.length}`);
  } else {
    console.log('\nDRY RUN — re-run with --apply');
  }
  await prisma.$disconnect();
})();
