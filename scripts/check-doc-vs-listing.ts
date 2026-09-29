/** Pre-apply check of an owner description document against the live listing.
 *
 *  Owner rule (28 Sep 2026): editorial problems I fix myself; a product FACT
 *  that differs between the document and the website waits for the owner.
 *  This prints both, per SKU, without writing anything:
 *
 *   EDIT  — mine to fix: title > 60, meta > 160 or cut mid-phrase, "Suitable
 *           For", "Useful Features", a comparison with other listings
 *   FACT  — the owner's call: a number+unit (W, L, ml, cm, kg, g, inch, pc)
 *           or a colour the document states that the listing does not carry
 *           (name, size label, power, capacity, weight, dimensions, colour)
 *
 *  Weights are compared as grams, so "5 kg 300 g" matches "5kg 300g".
 *
 *  Usage: npx tsx scripts/check-doc-vs-listing.ts <doc.txt> [more.txt…]
 */
import { readFileSync } from 'fs';
import { basename } from 'path';
import { prisma } from '../lib/db';

type Section = { sku: string; heading: string; title?: string; meta?: string; specs: string[]; body: string[] };

function parse(file: string): Section[] {
  const out: Section[] = [];
  let cur: Section | null = null;
  let zone: 'specs' | 'body' | 'title' | 'meta' | null = null;
  let heading = '';
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const tags = /^\[([^\]]*)\]/.exec(raw)?.[1] ?? '';
    const t = raw.replace(/^\[[^\]]*\]\s?/, '').trim();
    if (tags.includes('Heading1')) { heading = t; continue; }
    if (t.startsWith('SKU:')) {
      const m = /KK-[A-Z]+-\d+|\b[A-Z]{2,}-[A-Z0-9]+(?:-[A-Z0-9]+)+\b|[A-Z]{2,}[A-Z0-9]*\d+-[A-Za-z0-9./()-]*[A-Za-z0-9)]/.exec(t.slice(4));
      cur = { sku: (m ? m[0] : t.slice(4)).trim(), heading, specs: [], body: [] };
      out.push(cur);
      zone = null;
      continue;
    }
    if (!cur) continue;
    if (tags.includes('Heading2')) {
      zone = /Main Specifications/i.test(t) ? 'specs'
        : /^Product Description$/i.test(t) ? 'body'
        : /^(SEO|Meta) Title$/i.test(t) ? 'title'
        : /^Meta Description$/i.test(t) ? 'meta'
        : zone === 'body' && !/Search Phrases|Keywords/i.test(t) ? 'body' : null;
      if (zone === 'body' && !/^Product Description$/i.test(t)) cur.body.push(t);
      continue;
    }
    if (!t) continue;
    if (zone === 'specs') cur.specs.push(t);
    else if (zone === 'body') cur.body.push(t);
    else if (zone === 'title' && !cur.title) { cur.title = t; zone = null; }
    else if (zone === 'meta' && !cur.meta) { cur.meta = t; zone = null; }
  }
  return out;
}

function grams(s: string): number | null {
  const x = s.toLowerCase();
  let total = 0; let hit = false;
  for (const m of x.matchAll(/(\d+(?:\.\d+)?)\s*(?:kgs?|kilo(?:gram)?s?)\b/g)) { total += parseFloat(m[1]) * 1000; hit = true; }
  for (const m of x.replace(/(\d+(?:\.\d+)?)\s*(?:kgs?|kilo(?:gram)?s?)\b/g, ' ').matchAll(/(\d+(?:\.\d+)?)\s*(?:g|gm|gms|grams?)\b/g)) { total += parseFloat(m[1]); hit = true; }
  return hit ? Math.round(total) : null;
}

/** Lowercase, no spaces or commas; 43", 43″ and "43 Inch" all become "43in". */
const norm = (s: string) => s.toLowerCase().replace(/inch(es)?|["”″]/g, 'in').replace(/[\s,]+/g, '');
const COLOURS = ['rose gold', 'black', 'white', 'grey', 'gray', 'silver', 'gold', 'brown', 'beige', 'blue', 'red', 'green', 'yellow', 'pink', 'transparent', 'orange', 'purple'];
const UNIT = /(\d+(?:\.\d+)?)\s?(w|kw|l|ltr|ml|cm|mm|kg|g|gm|in|inch|"|v|hz|pc|pcs)\b/gi;
const COMPARE = /\b(among (these|the listed|our|other)|within (this|the kitchenary kart)[^.]*range|higher[- ]rated|higher[- ]wattage option|larger option|compared (to|with)|than (the|our|other|a larger|larger)|other models?|distinct option within|larger electric|without requiring (a|the) (large|larger))\b/i;

(async () => {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error('usage: check-doc-vs-listing.ts <doc.txt>…');
  let facts = 0;
  for (const file of files) {
    const sections = parse(file);
    console.log(`\n=== ${basename(file)} · ${sections.length} SKUs`);
    // Two queries for the whole document: a long run of per-SKU round trips
    // outlived the Neon connection on the 37-SKU soap document.
    const skus = sections.map((s) => s.sku);
    const variants = await prisma.productVariant.findMany({
      where: { skuSuffix: { in: skus } },
      select: { id: true, skuSuffix: true, variantValue: true, weight: true, power: true, capacity: true, dimensions: true, productId: true },
    });
    const products = await prisma.product.findMany({
      where: { OR: [{ sku: { in: skus } }, { id: { in: variants.map((v) => v.productId) } }] },
      select: { id: true, sku: true, name: true, weight: true, power: true, capacity: true, dimensions: true, material: true, color: true },
    });
    for (const s of sections) {
      const v = variants.find((x) => x.skuSuffix === s.sku) ?? null;
      const p = (v ? products.find((x) => x.id === v.productId) : products.find((x) => x.sku === s.sku)) ?? null;
      if (!p) { console.log(`  ${s.sku.padEnd(22)} NOT FOUND in catalogue`); continue; }
      const listing = [p.name, v?.variantValue, v?.power ?? p.power, v?.capacity ?? p.capacity, v?.dimensions ?? p.dimensions, p.material, p.color]
        .filter(Boolean).join(' | ');
      const hay = norm(listing);
      const listedGrams = grams(v?.weight ?? p.weight ?? '');

      const edit: string[] = [];
      const fact: string[] = [];
      if (!s.title) edit.push('no SEO title'); else if (s.title.length > 60) edit.push(`title ${s.title.length}`);
      if (!s.meta) edit.push('no meta'); else {
        if (s.meta.length > 160) edit.push(`meta ${s.meta.length}`);
        if (!/[.!]$/.test(s.meta) || /\b(and|or|the|for|with|,)\.$/i.test(s.meta)) edit.push('meta cut mid-phrase');
      }
      const all = [...s.body, ...s.specs];
      if (all.some((l) => /^Suitable For:/.test(l))) edit.push('"Suitable For"');
      if (s.body.includes('Useful Features')) edit.push('"Useful Features"');
      if (!all.some((l) => /^Care & Use:/i.test(l))) edit.push('no Care & Use');
      for (const l of s.body) { const m = COMPARE.exec(l); if (m) edit.push(`compares: "${m[0]}"`); }

      // Facts: weights by value, other number+unit tokens by presence, colours by presence.
      const text = [s.heading, s.title ?? '', s.meta ?? '', ...s.specs, ...s.body].join(' \n ');
      const seenTok = new Set<string>();
      for (const line of [...s.specs, ...s.body]) {
        if (!/weight/i.test(line)) continue;
        const g = grams(line);
        if (g != null && g !== listedGrams) fact.push(`weight: doc ${line.replace(/^.*?:\s*/, '')} · listing ${v?.weight ?? p.weight ?? '—'}`);
      }
      for (const m of text.replace(/[^\n]*weight[^\n]*/gi, ' ').matchAll(UNIT)) {
        const tok = norm(`${m[1]}${m[2] === '"' ? 'in' : m[2]}`);
        if (seenTok.has(tok)) continue;
        seenTok.add(tok);
        if (!hay.includes(tok)) fact.push(`"${m[0].trim()}" not in listing`);
      }
      const lowerText = text.toLowerCase().replace(/rose gold/g, 'rosegold');
      const lowerHay = listing.toLowerCase().replace(/rose gold/g, 'rosegold');
      for (const c of COLOURS) {
        const k = c.replace(' ', '');
        if (new RegExp(`\\b${k}\\b`).test(lowerText) && !new RegExp(`\\b${k}\\b`).test(lowerHay)) fact.push(`colour "${c}" not in listing`);
      }
      facts += fact.length;
      const where = v ? `variant #${v.id}` : `product #${p.id}`;
      console.log(`  ${s.sku.padEnd(22)} ${where.padEnd(14)} ${fact.length ? 'FACT ' + fact.join(' ; ') : 'facts ok'}${edit.length ? '  |  EDIT ' + edit.join(' ; ') : ''}`);
      if (fact.length) console.log(`  ${''.padEnd(22)} listing: ${listing}`);
    }
  }
  console.log(`\n${facts} fact difference(s) to confirm with the owner`);
  await prisma.$disconnect();
})();
