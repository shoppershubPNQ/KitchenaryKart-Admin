/** Strip the copywriter's repeated filler from a description document (owner rule,
 *  29 Sep 2026: "repeat words dont use").
 *
 *  Works on the Product Description section only — never titles, metas, search
 *  phrases or the Care & Use line (where "compatible chargers" is a safety point).
 *  A bullet's bold label ("Wooden Handle:") is left alone; the text after it is
 *  cleaned. Filler adjectives are removed; a few stock phrases are varied, not
 *  swapped for another stock word (turning "provides" into "gives" only moved the
 *  count). "a" becomes "an" where a removal left it before a vowel.
 *
 *  Prints the top words before and after so the effect can be checked.
 *
 *  Usage: node scripts/clean-doc-filler.mjs <in.txt> <out.txt>
 */
import { readFileSync, writeFileSync } from 'fs';

const [SRC, OUT] = process.argv.slice(2);
if (!SRC || !OUT) throw new Error('usage: clean-doc-filler.mjs <in.txt> <out.txt>');

export const FILLER = [
  [/\b[Ss]uitable (?!for\b)/g, ''],
  [/\bcompatible (?!with\b)/g, ''],
  [/\bdedicated /g, ''],
  [/ according to the (product|accessory) design/g, ''],
  [/ as applicable/g, ''],
  [/\bis useful when\b/g, 'helps when'],
  [/\bis useful for\b/g, 'works well for'],
  [/\ba useful addition\b/g, 'a handy addition'],
  [/^Useful for /, 'Good for '],
  [/^Useful when /, 'Handy when '],
  [/^Useful where /, 'Handy where '],
  [/\b(compact|larger|smaller|bigger) format\b/gi, '$1 size'],
  [/\b(oval|round|rectangular|rectangle|curved|two-sided|triangle|Y-shaped|traditional pan) format\b/gi, '$1 shape'],
];

const STOP = new Set('a an the and or for of to in on with is it its this that as at by be are from your you can when while into more than use used using their them per each which one two'.split(' '));
function topWords(lines) {
  const f = new Map();
  let inBody = false;
  for (const raw of lines) {
    if (raw === '[Heading2] Product Description') { inBody = true; continue; }
    if (raw.startsWith('[Heading2] SEO Title') || raw.startsWith('[Heading1]')) { inBody = false; continue; }
    if (!inBody) continue;
    for (const w of raw.replace(/^\[[^\]]*\]\s?/, '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)) {
      if (w.length > 2 && !STOP.has(w)) f.set(w, (f.get(w) ?? 0) + 1);
    }
  }
  return [...f].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w, n]) => `${w}×${n}`).join(' ');
}

const lines = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n').split('\n');
const before = topWords(lines);
let inBody = false;
let changed = 0;
for (let i = 0; i < lines.length; i++) {
  const raw = lines[i];
  if (raw === '[Heading2] Product Description') { inBody = true; continue; }
  if (raw.startsWith('[Heading2] SEO Title') || raw.startsWith('[Heading1]')) { inBody = false; continue; }
  if (!inBody || raw.startsWith('[Heading')) continue;
  const tag = /^\[[^\]]*\]\s?/.exec(raw)?.[0] ?? '';
  const t = raw.slice(tag.length);
  if (/^(Care & Use|Suitable for):/i.test(t)) {
    // Suitable-for keeps its label; its text loses the filler adjectives only.
    if (/^Suitable for:/i.test(t)) {
      const txt = t.replace(/^Suitable for:\s*/i, '');
      let c = txt;
      for (const [re, to] of FILLER.slice(0, 5)) c = c.replace(re, to);
      c = c.replace(/\s{2,}/g, ' ').replace(/^\w/, (x) => x.toUpperCase());
      if (c !== txt) { lines[i] = `${tag}Suitable for: ${c}`; changed++; }
    }
    continue;
  }
  const lab = /^([^:]{2,60}:\s)/.exec(t)?.[1] ?? '';
  let body = t.slice(lab.length);
  const orig = body;
  for (const [re, to] of FILLER) body = body.replace(re, to);
  body = body.replace(/\b([Aa]) ([aeio])/g, (x, a, v) => `${a}n ${v}`).replace(/\s{2,}/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  if (body !== orig) { lines[i] = `${tag}${lab}${body}`; changed++; }
}
writeFileSync(OUT, lines.join('\n'));
console.log(`${OUT}: ${changed} line(s) cleaned`);
console.log(`  before: ${before}`);
console.log(`  after:  ${topWords(lines)}`);
