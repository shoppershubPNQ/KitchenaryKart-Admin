/** Which of the owner's description documents are actually live?
 *
 *  A document can sit in scripts/docs for weeks without ever having been
 *  applied — the blender doc did exactly that, because the session it arrived
 *  in only used it to build the HSN list. This walks every document, pulls out
 *  the SKUs it covers, and asks the database whether the long description is
 *  really on the page.
 *
 *  "Live" means the stored description carries the house format's "Key
 *  Features" block, which every one of these documents produces and none of
 *  the old placeholder descriptions has.
 *
 *  Usage: npx tsx scripts/audit-description-docs.ts [file.txt…]
 *         (no arguments = every .txt in scripts/docs)
 */
import { readFileSync, readdirSync } from 'fs';
import { basename, join } from 'path';
import { prisma } from '../lib/db';

const DOCS = 'scripts/docs';
const FILES = process.argv.slice(2).filter((a) => !a.startsWith('--'));

/** Same two layouts apply-description-docs.ts understands. */
function skusIn(file: string): string[] {
  const out: string[] = [];
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\[([^\]]*)\]\s?(.*)$/.exec(raw);
    if (!m) continue;
    const text = m[2].trim();
    if (m[1].split(',').includes('Heading1')) {
      const b = /^(?:\d+\.?\s+)?(.+?)\s+—\s+([A-Z]{2,}[A-Z0-9]*\d+-[A-Z0-9.-]+)$/.exec(text);
      if (b) out.push(b[2]);
      continue;
    }
    if (text.startsWith('SKU:')) {
      const s = /KK-[A-Z]+-\d+|\b[A-Z]{2,}-[A-Z0-9]+(?:-[A-Z0-9]+)+\b|[A-Z]{2,}[A-Z0-9]*\d+-[A-Za-z0-9./()-]*[A-Za-z0-9)]/.exec(text.slice(4));
      if (s) out.push(s[0]);
    }
  }
  return [...new Set(out)];
}

(async () => {
  const files = (FILES.length ? FILES : readdirSync(DOCS).filter((f) => f.endsWith('.txt')).map((f) => join(DOCS, f))).sort();

  const rows: Array<{ file: string; total: number; live: number; missing: string[]; notFound: string[] }> = [];
  for (const file of files) {
    const skus = skusIn(file);
    if (!skus.length) continue;
    const missing: string[] = [];
    const notFound: string[] = [];
    let live = 0;
    for (const sku of skus) {
      const v = await prisma.productVariant.findFirst({ where: { skuSuffix: sku }, select: { description: true } });
      const p = v ? null : await prisma.product.findUnique({ where: { sku }, select: { description: true } });
      const d = (v ?? p)?.description ?? null;
      if (!v && !p) { notFound.push(sku); continue; }
      if (d && d.includes('Key Features')) live++;
      else missing.push(`${sku} (${d?.length ?? 0} ch)`);
    }
    rows.push({ file: basename(file), total: skus.length, live, missing, notFound });
  }

  rows.sort((a, b) => (a.live / a.total) - (b.live / b.total));
  console.log('document                                                  live / total');
  for (const r of rows) {
    const flag = r.live === r.total ? '✓' : r.live === 0 ? '✗ NOT APPLIED' : '· partial';
    console.log(`${r.file.padEnd(58)} ${String(r.live).padStart(3)} / ${String(r.total).padEnd(3)} ${flag}`);
  }
  for (const r of rows) {
    if (!r.missing.length && !r.notFound.length) continue;
    console.log(`\n${r.file}`);
    if (r.missing.length) console.log(`  no long description yet: ${r.missing.join(', ')}`);
    if (r.notFound.length) console.log(`  SKU not in catalogue:    ${r.notFound.join(', ')}`);
  }
  const t = rows.reduce((a, r) => a + r.total, 0);
  const l = rows.reduce((a, r) => a + r.live, 0);
  console.log(`\n${l} of ${t} documented SKUs are live · ${t - l} still to do`);
  await prisma.$disconnect();
})();
