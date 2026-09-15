/** Remove spare -> machine links whose SIZES disagree.
 *  Owner 2026-09-15: "7L ke parts 10L mein nahi lagte — har fits mat karo".
 *  A spare whose name carries a size ("Planetary Mixer 7L - Bowl",
 *  "10L/20L/30L - Handle Set") stays linked only to machines of one of those
 *  sizes. If either side has no size in it, the link is kept (can't tell).
 *  Reads/writes web/lib/spare-fits.json. Dry run unless --apply. */
import * as fs from 'fs';
import { prisma } from '../lib/db';

const FILE = 'C:/Users/Admin/OneDrive/Vishakha Details/Kitchenary Kart WEB Project/C-code/web/lib/spare-fits.json';
const APPLY = process.argv.includes('--apply');

/** "7L", "10L/20L/30L", "1.5 kg", "500ml" -> {"7l"} / {"10l","20l","30l"} ... */
function sizes(text: string): Set<string> {
  const out = new Set<string>();
  const t = text.toLowerCase().replace(/litres?|liters?|ltrs?/g, 'l');
  // expand "10l/20l/30l" and "20/30l" style lists
  for (const m of t.matchAll(/(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)*)\s?(l|ml|kg|g)\b/g)) {
    for (const n of m[1].split('/')) out.add(`${Number(n.trim())}${m[2]}`);
  }
  return out;
}

(async () => {
  const fits: Record<string, string[]> = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const allSkus = [...new Set([...Object.keys(fits), ...Object.values(fits).flat()])];
  const [prods, vars] = await Promise.all([
    prisma.product.findMany({ where: { sku: { in: allSkus } }, select: { sku: true, name: true, capacity: true } }),
    prisma.productVariant.findMany({ where: { skuSuffix: { in: allSkus } }, select: { skuSuffix: true, variantValue: true, capacity: true, product: { select: { name: true } } } }),
  ]);
  // A variant SKU describes one size: its own value/capacity, not the parent name.
  const text = new Map<string, { name: string; sizeText: string }>();
  for (const p of prods) text.set(p.sku, { name: p.name, sizeText: `${p.name} ${p.capacity ?? ''}` });
  for (const v of vars) if (v.skuSuffix) text.set(v.skuSuffix, { name: `${v.product.name} — ${v.variantValue ?? ''}`, sizeText: `${v.variantValue ?? ''} ${v.capacity ?? ''}` });

  const next: Record<string, string[]> = {};
  const removed: string[] = [];
  let kept = 0;
  for (const [spare, machines] of Object.entries(fits)) {
    const s = sizes(text.get(spare)?.name ?? '');
    for (const m of machines) {
      const ms = sizes(text.get(m)?.sizeText ?? '');
      const clash = s.size > 0 && ms.size > 0 && ![...s].some((x) => ms.has(x));
      if (clash) {
        removed.push(`${spare} (${[...s].join('/')}) -x-> ${m} (${[...ms].join('/')})  | ${(text.get(spare)?.name ?? '').replace(/^Spares for /, '').slice(0, 55)}`);
      } else {
        (next[spare] ||= []).push(m);
        kept++;
      }
    }
  }
  const spares = Object.keys(next).length;
  console.log(`links before ${kept + removed.length} | removed ${removed.length} | kept ${kept} | spares still linked ${spares}${APPLY ? '' : '  [DRY RUN]'}`);
  for (const r of removed) console.log('  ' + r);
  if (APPLY) {
    fs.writeFileSync(FILE.replace(/\.json$/, `.backup-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(fits, null, 1) + '\n');
    fs.writeFileSync(FILE, JSON.stringify(next, null, 1) + '\n');
    console.log('written', FILE);
  }
  await prisma.$disconnect();
})();
