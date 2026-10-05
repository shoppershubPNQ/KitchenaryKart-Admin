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
    // Product names can themselves contain "|" ("Eco Induction - 3000W |
    // Square | Flat Base"), which is also the column separator. The LAST four
    // columns are fixed (SKU, Category, HSN, GST), so read from the right.
    const [sku, , hsn, gst] = cells.slice(-4);
    const name = cells.slice(1, -4).join(' | ');
    if (!/^[A-Z]{2,}[A-Z0-9-]*\d/.test(sku)) continue; // header row ("SKU")
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

  // Two queries for the whole catalogue instead of two per row.
  const sel = { id: true, sku: true, hsnCode: true, taxPercent: true } as const;
  const products = await prisma.product.findMany({ select: sel });
  const variants = await prisma.productVariant.findMany({ select: { skuSuffix: true, product: { select: sel } } });
  const productBySku = new Map(products.map((p) => [p.sku, p]));
  const parentByVariantSku = new Map(variants.map((v) => [v.skuSuffix, v.product]));

  // One decision per PRODUCT: a listing's sizes may appear as separate rows
  // (and a SKU in two documents); they must agree, or nothing is written.
  const wanted = new Map<number, { hsn: string; gst: number; from: string[] }>();

  for (const r of rows) {
    if (!/^\d{4,8}$/.test(r.hsn)) { suspect.push(`${r.sku}: HSN "${r.hsn}" is not 4-8 digits`); continue; }
    const gstNum = Number(r.gst.replace('%', ''));
    if (!Number.isFinite(gstNum) || gstNum < 0 || gstNum > 28) { suspect.push(`${r.sku}: GST "${r.gst}" unreadable`); continue; }

    // The HSN and the GST rate live on the PRODUCT row; a variant SKU means
    // its parent, because a variant has no tax fields of its own.
    const p = productBySku.get(r.sku) ?? parentByVariantSku.get(r.sku) ?? null;
    if (!p) { notFound.push(r); continue; }
    const wasGst = Number(p.taxPercent);

    // Only a full 8-digit HSN is ever written. A short code that our stored
    // 8-digit code already starts with is agreement, not a change.
    if (!/^\d{8}$/.test(r.hsn)) {
      if (/^\d{8}$/.test(p.hsnCode ?? '') && p.hsnCode!.startsWith(r.hsn) && wasGst === gstNum) { same.push(r); continue; }
      suspect.push(`${r.sku}: HSN "${r.hsn}" is only ${r.hsn.length} digits (stored ${p.hsnCode ?? '—'}) — not written`);
      continue;
    }
    const prev = wanted.get(p.id);
    if (prev && (prev.hsn !== r.hsn || prev.gst !== gstNum)) {
      suspect.push(`${p.sku}: rows disagree — ${prev.from.join(', ')} say ${prev.hsn}/${prev.gst}%, ${r.sku} says ${r.hsn}/${gstNum}% — not written`);
      prev.hsn = '__conflict__';
      continue;
    }
    if (prev) { prev.from.push(r.sku); continue; }
    wanted.set(p.id, { hsn: r.hsn, gst: gstNum, from: [r.sku] });
    if ((p.hsnCode ?? '') === r.hsn && wasGst === gstNum) same.push(r);
    else changes.push({ ...r, id: p.id, wasHsn: p.hsnCode, wasGst, gstNum });
  }
  // Drop any product whose rows turned out to conflict.
  for (let i = changes.length - 1; i >= 0; i--) if (wanted.get(changes[i].id)?.hsn === '__conflict__') changes.splice(i, 1);

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
