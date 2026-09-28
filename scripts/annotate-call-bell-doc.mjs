/** Corrected copy of the owner's 2-SKU SS call bell document (28 Sep 2026).
 *
 *  Editorial fixes only — no spec in the document differs from the listing
 *  (Stainless Steel; sizes Small / Big):
 *  - "Suitable For:" → "Suitable for:", the house label.
 *  - Both SEO titles ran over 60 (64, 63); rewritten in one pattern.
 *
 *  Usage: node scripts/annotate-call-bell-doc.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const SRC = 'scripts/docs/Kitchenary_Kart_SS_Call_Bell_All_2_Product_Descriptions.txt';
const OUT = 'scripts/docs/call-bell-2-annotated.txt';

const REPLACE = [
  ['[] Small SS Call Bell / Service Bell for Counter | Kitchenary Kart', '[] SS Counter Call Bell / Service Bell, Small | Kitchenary Kart'],
  ['[] Big SS Call Bell / Service Bell for Reception | Kitchenary Kart', '[] SS Counter Call Bell / Service Bell, Big | Kitchenary Kart'],
];

let text = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
for (const [from, to] of REPLACE) {
  if (!text.includes(from)) throw new Error(`not found: ${from}`);
  text = text.replace(from, to);
}
const labels = (text.match(/^\[b\] Suitable For:/gm) ?? []).length;
text = text.replace(/^\[b\] Suitable For:/gm, '[b] Suitable for:');
if (labels !== 2) throw new Error(`expected 2 labels, found ${labels}`);

const lines = text.split('\n');
lines.forEach((l, i) => {
  const next = lines[i + 1]?.slice(3) ?? '';
  if (l === '[Heading2] SEO Title' && next.length > 60) throw new Error(`title ${next.length}: ${next}`);
  if (l === '[Heading2] Meta Description' && (next.length > 160 || !/[.!]$/.test(next))) throw new Error(`meta: ${next}`);
  if (l === '[Heading2] SEO Title') console.log(`  T${String(next.length).padStart(3)} ${next}`);
});
writeFileSync(OUT, text);
console.log(OUT);
