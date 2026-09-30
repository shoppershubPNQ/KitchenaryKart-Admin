/** READ-ONLY listing audit (owner 30 Sep 2026: "isse or bhi mistake hai find out
 *  kro" → "Har ek category check kro").
 *  Usage: npx tsx scripts/audit-listings.ts [CATEGORY | ALL]
 */
import { prisma } from '../lib/db';

const CAT = process.argv[2] ?? 'ALL';
const HIDDEN = /[ ​-‏ ⁠﻿]/;
const vol = (s: string) => {
  const m = /(\d+(?:\.\d+)?)\s*(ml|l|ltr|litre|liter)\b/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return /ml/i.test(m[2]) ? n : n * 1000;
};
const num = (s: string) => Number(/(\d+(?:\.\d+)?)/.exec(s)?.[1] ?? NaN);
/** first material named in the product NAME that is not the handle's */
function bodyMaterial(name: string): string | null {
  const cleaned = name.replace(/\b(Wooden|Plastic|SS|Steel|Silicone?|Acrylic|Metal|Rubber|Black|White|Red|Golden?|Flat|Round|Curved)(\s+(Flat|Round|Curved|Black|White|Red))*\s+Handle\b/gi, ' ');
  const m = /\b(Full SS|SS|Stainless Steel|Plastic|PC|PP|ABS|Polycarbonate|Acrylic|Glass|Aluminium|Aluminum|Cast Iron|Iron|MS|Wooden|Wood|Bamboo|Silicone?|Teflon|Copper|Brass|Ceramic|Porcelain|Melamine)\b/i.exec(cleaned);
  return m ? m[1] : null;
}
const FAMILY: Array<[RegExp, RegExp]> = [
  [/^(full ss|ss|stainless steel)$/i, /stainless|steel|^ss/i],
  [/^(plastic|pc|pp|abs|polycarbonate|acrylic|melamine)$/i, /plastic|pc|pp|abs|polycarbonate|acrylic|melamine|poly/i],
  [/^glass$/i, /glass/i],
  [/^alumin/i, /alumin/i],
  [/^(cast iron|iron|ms)$/i, /iron|mild steel|^ms|metal/i],
  [/^(wooden|wood|bamboo)$/i, /wood|bamboo/i],
  [/^silicone?$/i, /silicon/i],
  [/^teflon$/i, /teflon|non.?stick|alumin/i],
  [/^(copper|brass)$/i, /copper|brass/i],
  [/^(ceramic|porcelain)$/i, /ceramic|porcelain/i],
];
const SMALL = new Set('with and for of in on to x or by the a an without into per cm mm ml l kg g pc pcs pp w v ltr inch x2 x3'.split(' '));

(async () => {
  const ps = await prisma.product.findMany({
    where: CAT === 'ALL' ? {} : { category: CAT },
    select: { id: true, sku: true, name: true, status: true, category: true, capacity: true, material: true, weight: true,
      variants: { select: { skuSuffix: true, variantValue: true, weight: true, price: true } } },
  });
  const out: Record<string, string[]> = {};
  const add = (k: string, s: string) => (out[k] ??= []).push(s);
  const words = new Map<string, Set<string>>();

  for (const p of ps) {
    const tag = `${p.sku} [${p.category ?? '-'}]${p.status === 'active' ? '' : ` (${p.status})`}`;
    if (HIDDEN.test(p.name)) add('Hidden character in name', `${tag}: ${JSON.stringify(p.name)}`);
    if (/\s{2,}|\s$|^\s/.test(p.name)) add('Double / trailing space in name', `${tag}: ${JSON.stringify(p.name)}`);
    const lower = p.name.split(/[\s/(),+|–—-]+/).filter((w) => /^[a-z]{3,}/.test(w) && !SMALL.has(w));
    if (lower.length) add('Lowercase word in name', `${tag}: ${lower.join(', ')} — "${p.name}"`);
    for (const w of p.name.split(/[^A-Za-z]+/).filter((w) => w.length > 2)) {
      const k = w.toLowerCase();
      if (!words.has(k)) words.set(k, new Set());
      words.get(k)!.add(p.sku);
    }
    const nv = vol(p.name), fv = p.capacity ? vol(p.capacity) : null;
    if (!p.variants.length && nv && fv && Math.abs(nv - fv) > 1) add('Name capacity ≠ capacity field', `${tag}: name "${p.name}" · field ${p.capacity}`);
    const body = bodyMaterial(p.name);
    if (body && p.material) {
      const fam = FAMILY.find(([n]) => n.test(body));
      if (fam && !fam[1].test(p.material)) add('Material in name ≠ material field', `${tag}: name says ${body} · field "${p.material}" — "${p.name}"`);
    }
    if (p.variants.length > 1) {
      const sized = p.variants
        .filter((v) => !/^\s*no\.?\s*\d/i.test(v.variantValue ?? ''))
        .map((v) => ({ v, size: vol(v.variantValue ?? '') ?? num(v.variantValue ?? '') }))
        .filter((x) => Number.isFinite(x.size) && x.v.price != null);
      if (sized.length > 1 && new Set(sized.map((x) => x.size)).size === sized.length) {
        sized.sort((a, b) => a.size - b.size);
        for (let i = 1; i < sized.length; i++) if (Number(sized[i].v.price) < Number(sized[i - 1].v.price)) add('Bigger size priced lower than a smaller one', `${tag} "${p.name}": ${sized[i - 1].v.variantValue} ₹${sized[i - 1].v.price} > ${sized[i].v.variantValue} ₹${sized[i].v.price}`);
      }
      const vals = p.variants.map((v) => (v.variantValue ?? '').trim().toLowerCase());
      const dup = vals.filter((v, i) => v && vals.indexOf(v) !== i);
      if (dup.length) add('Two size/colour options with the same label', `${tag} "${p.name}": ${[...new Set(dup)].join(', ')}`);
    }
  }
  const rare = [...words].filter(([, s]) => s.size === 1).map(([w, s]) => `${w} (${[...s][0]})`).sort();
  for (const [k, v] of Object.entries(out)) { console.log(`\n## ${k} (${v.length})`); for (const s of v) console.log('  ' + s); }
  console.log(`\n## Words used in only one listing (${rare.length}) — spelling check`);
  console.log('  ' + rare.join(', '));
})().finally(() => prisma.$disconnect());
