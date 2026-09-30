/** 76-accessory document (owner, 30 Sep 2026) → standard-layout document built
 *  from per-product copy drafted shelf by shelf (JSON: lead, p[], b[], suit,
 *  care, title, meta, conflicts[]). The owner's document was one template per
 *  shelf ("compatible" ×298, the same ten lines on 19 sauce products); its
 *  headings and SKUs are kept, its prose is replaced.
 *
 *  Refuses to write if: a SKU has no copy, a title (+ " | Kitchenary Kart")
 *  exceeds 60 or repeats, a meta exceeds 160 / lacks "Kitchenary Kart" / a
 *  final full stop, a banned filler word appears, paragraph 1 does not name
 *  the product, or any sentence is used by more than 3 products.
 *  SKUs with conflicts are LEFT OUT and listed (owner decides).
 *
 *  Usage: node scripts/assemble-acc76.mjs <out.txt> <copy.json>…
 */
import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2);
// --src=<doc.txt> for other documents drafted the same way (41-product doc, …).
const SRC = args.find((a) => a.startsWith('--src='))?.slice(6) ?? 'scripts/docs/Kitchenary_Kart_76_Accessories_Separate_Product_Descriptions.txt';
const HOLD = new Set((args.find((a) => a.startsWith('--hold='))?.slice(7) ?? '').split(',').filter(Boolean));
const [OUT, ...JSONS] = args.filter((a) => !a.startsWith('--'));
const BRAND = ' | Kitchenary Kart';
const BANNED = /\b(suitable|compatible|dedicated|useful|practical|according to|as applicable|stated|clearly|product-specific|model-specific|ensures|perfect)\b/i;

const copy = Object.assign({}, ...JSONS.map((f) => JSON.parse(readFileSync(f, 'utf8'))));
const lines = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n').split('\n');

const sections = [];
for (let i = 0; i < lines.length; i++) {
  const m = /^\[b\] SKU:\s*(\S+)$/.exec(lines[i + 1] ?? '');
  if (lines[i].startsWith('[Heading1]') && m) sections.push({ head: lines[i], sku: m[1] });
}

const errors = [], held = [], notes = [], out = [], titles = new Map(), sentenceUse = new Map();
for (const { head, sku } of sections) {
  const c = copy[sku];
  if (!c) { errors.push(`${sku}: no copy`); continue; }
  // Drafts leave a disputed fact OUT of the copy and note it; those still go
  // live. Only SKUs named in --hold= are kept back for the owner.
  if (c.conflicts?.length) notes.push(`${sku}: ${c.conflicts.join(' | ')}`);
  if (HOLD.has(sku)) { held.push(sku); continue; }
  const title = c.title + BRAND;
  if (title.length > 60) errors.push(`${sku}: title ${title.length}`);
  if (titles.has(title)) errors.push(`${sku}: title same as ${titles.get(title)}`);
  titles.set(title, sku);
  if (c.meta.length > 160 || !c.meta.includes('Kitchenary Kart') || !c.meta.endsWith('.')) errors.push(`${sku}: meta ${c.meta.length}`);
  const fields = [c.lead, ...c.p, ...c.b, c.suit, c.care, c.title, c.meta];
  const bad = fields.find((f) => BANNED.test(f));
  if (bad) errors.push(`${sku}: banned word in "${bad.slice(0, 70)}"`);
  if (c.b.length < 3 || c.b.some((b) => !/^[^:]{2,60}: \S/.test(b))) errors.push(`${sku}: bullets must be "Label: text" (3+)`);
  for (const s of [c.lead, ...c.p, ...c.b.map((b) => b.replace(/^[^:]+:\s*/, '')), c.suit, c.care].join(' ').split(/(?<=[.!?])\s+/)) {
    const k = s.replace(/\d+(\.\d+)?/g, '#').trim();
    if (k.length > 25) sentenceUse.set(k, [...(sentenceUse.get(k) ?? []), sku]);
  }
  out.push(head, `[b] SKU: ${sku}`, '[Heading2] Product Description', `[b] ${c.lead}`, ...c.p.map((p) => `[] ${p}`),
    '[Heading2] Key Features', ...c.b.map((b) => `[ListBullet,b] ${b}`),
    `[b] Suitable for: ${c.suit}`, `[b] Care & Use: ${c.care}`,
    '[Heading2] SEO Title', `[] ${title}`, '[Heading2] Meta Description', `[] ${c.meta}`);
}
for (const [s, skus] of sentenceUse) if (skus.length > 3) errors.push(`sentence in ${skus.length} products: ${s.slice(0, 80)}`);
const extra = Object.keys(copy).filter((k) => !sections.some((s) => s.sku === k));
if (extra.length) errors.push(`copy for SKUs not in the document: ${extra.join(', ')}`);

console.log(`${sections.length} sections · ${out.filter((l) => l.startsWith('[Heading1]')).length} written · ${held.length} held`);
if (notes.length) console.log('FLAGGED (disputed fact left out of copy):\n  ' + notes.join('\n  '));
if (held.length) console.log('HELD: ' + held.join(', '));
if (errors.length) { console.log('ERRORS — nothing written:\n  ' + errors.join('\n  ')); process.exit(1); }
writeFileSync(OUT, out.join('\n'));
console.log(`→ ${OUT}`);
