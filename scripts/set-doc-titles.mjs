/** Replace SEO titles in a standard-layout description document by SKU, and
 *  normalise the "Suitable For:" label to "Suitable for:". Fails if a mapped
 *  SKU is missing, a title (with " | Kitchenary Kart") exceeds 60 characters,
 *  or two products end up with the same title.
 *
 *  Usage: node scripts/set-doc-titles.mjs <in.txt> <out.txt> <titles.json>
 *    titles.json = { "SKU": "Title without the brand suffix", ... }
 */
import { readFileSync, writeFileSync } from 'fs';

const [SRC, OUT, MAP] = process.argv.slice(2);
const map = JSON.parse(readFileSync(MAP, 'utf8'));
const lines = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n').split('\n');
let sku = '';
const used = new Set(), seen = new Map();
for (let i = 0; i < lines.length; i++) {
  const m = /^\[[^\]]*\] SKU:\s*(\S+)/.exec(lines[i]);
  if (m) sku = m[1];
  lines[i] = lines[i].replace(/^(\[[^\]]*\] )Suitable For:/, '$1Suitable for:');
  if (lines[i] === '[Heading2] SEO Title') {
    if (map[sku]) { lines[i + 1] = `[] ${map[sku]} | Kitchenary Kart`; used.add(sku); }
    const t = lines[i + 1].slice(3);
    if (t.length > 60) throw new Error(`${sku}: title ${t.length} — ${t}`);
    if (seen.has(t)) throw new Error(`${sku}: same title as ${seen.get(t)}`);
    seen.set(t, sku);
  }
}
const missing = Object.keys(map).filter((k) => !used.has(k));
if (missing.length) throw new Error(`not in document: ${missing.join(', ')}`);
writeFileSync(OUT, lines.join('\n'));
console.log(`${OUT}: ${used.size} title(s) set, ${seen.size} checked`);
