/** Read HSN/GST decisions back out of the owner's returned .docx tables, and
 *  optionally write them to the catalogue.
 *
 *  These are the numbers the accountant signed off, so the document wins — but
 *  it is tax data reaching live invoices, so the default is a dry run, every
 *  old value is backed up before anything changes, and rows that look like
 *  typing slips are printed loudly rather than passed over.
 *
 *  The HSN goes on the PRODUCT row (a variant SKU means its parent), as does
 *  the GST rate, which flows into every future order line and invoice.
 *
 *  Usage: npx tsx scripts/read-hsn-docs.ts <doc.txt>… [--apply]
 */
import { readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');
const FILES = process.argv.slice(2).filter((a) => !a.startsWith('--'));

interface Row { file: string; sku: string; name: string; hsn: string; gst: string }

function rowsOf(file: string): Row[] {
  const out: Row[] = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('[TBL] ')) continue;
    const cells = line.slice(6).split('|').map((c) => c.trim());
    if (cells.length < 6) continue;
    const [, name, sku, , hsn, gst] = cells;
    if (!/^[A-Z]{2}/.test(sku)) continue; // header row
    out.push({ file: basename(file), sku, name, hsn, gst });
  }
  return out;
}

(async () => {
  if (!FILES.length) throw new Error('usage: read-hsn-docs.ts <doc.txt>…');
  const rows = FILES.flatMap(rowsOf);
  console.log(`${rows.length} row(s) read from ${FILES.length} document(s)\n`);

  type Change = Row & { id: number; wasHsn: string | null; wasGst: number; gstNum: number };
  const changes: Change[] = [];
  const same: Row[] = [];
  const notFound: Row[] = [];
  const suspect: string[] = [];

  for (const r of rows) {
    if (!/^\d{4,8}$/.test(r.hsn)) { suspect.push(`${r.sku}: HSN "${r.hsn}" is not 4-8 digits`); continue; }
    const gstNum = Number(r.gst.replace('%', ''));
    if (!Number.isFinite(gstNum) || gstNum < 0 || gstNum > 28) { suspect.push(`${r.sku}: GST "${r.gst}" unreadable`); continue; }

    // The HSN and the GST rate live on the PRODUCT row; a variant SKU means
    // its parent, because a variant has no tax fields of its own.
    let p = await prisma.product.findUnique({ where: { sku: r.sku }, select: { id: true, sku: true, hsnCode: true, taxPercent: true } });
    if (!p) {
      const v = await prisma.productVariant.findFirst({ where: { skuSuffix: r.sku }, select: { product: { select: { id: true, sku: true, hsnCode: true, taxPercent: true } } } });
      p = v?.product ?? null;
    }
    if (!p) { notFound.push(r); continue; }
    const wasGst = Number(p.taxPercent);
    if ((p.hsnCode ?? '') === r.hsn && wasGst === gstNum) same.push(r);
    else changes.push({ ...r, id: p.id, wasHsn: p.hsnCode, wasGst, gstNum });
  }

  console.log(`unchanged : ${same.length}`);
  console.log(`CHANGED   : ${changes.length}`);
  console.log(`not found : ${notFound.length}`);
  if (suspect.length) console.log(`\n⚠ ${suspect.length} row(s) worth a second look:\n  ${[...new Set(suspect)].join('\n  ')}`);

  const gstMoves = changes.filter((c) => c.wasGst !== c.gstNum);
  if (changes.length) {
    console.log('\nCHANGES (stored → document):');
    for (const c of changes) {
      const hsnBit = (c.wasHsn ?? '') === c.hsn ? ''.padEnd(26) : `HSN ${String(c.wasHsn ?? '—').padEnd(9)}→ ${c.hsn.padEnd(9)}`;
      const gstBit = c.wasGst === c.gstNum ? '' : `  GST ${c.wasGst}% → ${c.gstNum}%`;
      console.log(`  ${c.sku.padEnd(22)} ${hsnBit}${gstBit}  ${c.name.slice(0, 40)}`);
    }
  }
  if (gstMoves.length) {
    console.log(`\n⚠ ${gstMoves.length} GST RATE CHANGE(S) — these reach every future invoice.`);
  }
  if (notFound.length) {
    console.log('\nSKUs in the documents that are not in the catalogue:');
    for (const n of notFound) console.log(`  ${n.sku.padEnd(22)} ${n.name.slice(0, 60)}`);
  }

  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply'); await prisma.$disconnect(); return; }

  const file = `backup-hsn-gst-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  writeFileSync(file, JSON.stringify(changes, null, 2));
  for (const c of changes) {
    await prisma.product.update({ where: { id: c.id }, data: { hsnCode: c.hsn, taxPercent: c.gstNum } });
  }
  let ok = 0;
  for (const c of changes) {
    const p = await prisma.product.findUnique({ where: { id: c.id }, select: { hsnCode: true, taxPercent: true } });
    if (p?.hsnCode === c.hsn && Number(p.taxPercent) === c.gstNum) ok++;
  }
  console.log(`\nbackup: ${file} · verified ${ok}/${changes.length}`);
  await prisma.$disconnect();
})();
