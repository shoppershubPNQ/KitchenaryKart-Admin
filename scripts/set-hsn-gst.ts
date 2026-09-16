/**
 * Set HSN code + GST rate on products from a CSV/TSV the owner supplies.
 *
 *   npx tsx scripts/set-hsn-gst.ts scripts/input/hsn-2026-09-16.csv [--apply]
 *
 * Columns: SKU, HSN, GST (header row optional). Without --apply it only shows
 * what would change.
 *
 * HSN and tax live ONLY on the parent product row — ProductVariant has neither
 * column — so one row per SKU. Changing tax_percent does NOT change what a
 * customer pays: prices are GST-INCLUSIVE, so the rate only re-splits the same
 * amount between net and tax. Past orders are untouched; order_items carry
 * their own tax_percent captured at sale time.
 *
 * Writes a timestamped backup of the previous values before touching anything.
 */
import { readFileSync, writeFileSync } from 'fs';
import { prisma } from '../lib/db';

interface Row { sku: string; hsn: string; gst: number }

function parse(path: string): Row[] {
  const out: Row[] = [];
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [sku, hsn, gst] = line.split(/[,\t]/).map((c) => c.trim());
    if (!sku || !hsn || !gst) continue;
    if (/^sku$/i.test(sku)) continue;
    const rate = Number(gst);
    if (!Number.isFinite(rate)) { console.log(`skipping unreadable GST on ${sku}: ${gst}`); continue; }
    out.push({ sku, hsn, gst: rate });
  }
  return out;
}

(async () => {
  const path = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!path) { console.error('Usage: set-hsn-gst.ts <file.csv> [--apply]'); process.exitCode = 1; return; }

  const rows = parse(path);
  const existing = await prisma.product.findMany({
    where: { sku: { in: rows.map((r) => r.sku) } },
    select: { id: true, sku: true, name: true, hsnCode: true, taxPercent: true },
  });
  const bySku = new Map(existing.map((p) => [p.sku, p]));

  const missing = rows.filter((r) => !bySku.has(r.sku)).map((r) => r.sku);
  if (missing.length) console.log(`NOT FOUND (skipped): ${missing.join(', ')}\n`);

  const todo = rows.filter((r) => {
    const p = bySku.get(r.sku);
    return p && (p.hsnCode !== r.hsn || Number(p.taxPercent) !== r.gst);
  });
  console.log(`${rows.length} row(s) in file, ${existing.length} matched, ${todo.length} need a change.`);
  if (!apply) { console.log('\nDry run. Re-run with --apply to write.'); await prisma.$disconnect(); return; }
  if (!todo.length) { console.log('Nothing to do.'); await prisma.$disconnect(); return; }

  const stamp = new Date().toISOString().slice(0, 10);
  const backup = `backup-hsn-gst-${stamp}.json`;
  writeFileSync(backup, JSON.stringify(
    todo.map((r) => {
      const p = bySku.get(r.sku)!;
      return { sku: p.sku, name: p.name, hsnCode: p.hsnCode, taxPercent: Number(p.taxPercent) };
    }), null, 1));
  console.log(`Previous values saved to ${backup}\n`);

  for (const r of todo) {
    const p = bySku.get(r.sku)!;
    await prisma.product.update({
      where: { id: p.id },
      data: { hsnCode: r.hsn, taxPercent: r.gst },
    });
    console.log(`${r.sku.padEnd(18)} HSN ${String(p.hsnCode ?? '(none)').padEnd(16)} -> ${r.hsn}   GST ${Number(p.taxPercent)}% -> ${r.gst}%`);
  }

  const after = await prisma.product.findMany({
    where: { sku: { in: todo.map((r) => r.sku) } },
    select: { sku: true, hsnCode: true, taxPercent: true },
  });
  const wrong = after.filter((a) => {
    const want = todo.find((r) => r.sku === a.sku)!;
    return a.hsnCode !== want.hsn || Number(a.taxPercent) !== want.gst;
  });
  console.log(`\nVerified ${after.length - wrong.length}/${todo.length} rows.`);
  if (wrong.length) console.log('DID NOT TAKE:', wrong.map((w) => w.sku).join(', '));
  await prisma.$disconnect();
})();
