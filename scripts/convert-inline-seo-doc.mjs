/** Convert a description document whose SEO lines sit inline under the product
 *  heading ("[] SKU: X | …", "[] SEO Title: …", "[] Meta Description: …") and
 *  whose lead / bullets are unbolded, into the standard layout the apply
 *  scripts read (bold SKU + lead, "[Heading2] SEO Title" sections, bold bullets).
 *  Prints title/meta lengths and fails on a title over 60, a meta over 160 or
 *  a duplicate title.
 *
 *  Usage: node scripts/convert-inline-seo-doc.mjs <in.txt> <out.txt>
 */
import { readFileSync, writeFileSync } from 'fs';

const [SRC, OUT] = process.argv.slice(2);
if (!SRC || !OUT) throw new Error('usage: convert-inline-seo-doc.mjs <in.txt> <out.txt>');
const lines = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n').split('\n');
const body = (l) => l.replace(/^\[[^\]]*\]\s?/, '');

const out = [];
const problems = [];
const titles = new Map();
let i = 0;
while (i < lines.length && !lines[i].startsWith('[Heading1]')) i++;
while (i < lines.length) {
  const head = lines[i++];
  const sec = [];
  while (i < lines.length && !lines[i].startsWith('[Heading1]')) sec.push(lines[i++]);
  const sku = /SKU:\s*([^\s|]+)/.exec(sec.find((l) => /SKU:/.test(l)) ?? '')?.[1];
  if (!sku) { problems.push(`no SKU under ${head}`); continue; }
  const title = body(sec.find((l) => /^\[[^\]]*\] SEO Title:/.test(l)) ?? '').replace(/^SEO Title:\s*/, '');
  const meta = body(sec.find((l) => /^\[[^\]]*\] Meta Description:/.test(l)) ?? '').replace(/^Meta Description:\s*/, '');
  const search = body(sec.find((l) => /^\[[^\]]*\] Search phrases:/i.test(l)) ?? '').replace(/^Search phrases:\s*/i, '');
  const d = sec.indexOf('[Heading2] Product Description');
  const k = sec.indexOf('[Heading2] Key Features');
  if (d < 0 || k < 0) { problems.push(`${sku}: missing Product Description / Key Features`); continue; }
  const paras = sec.slice(d + 1, k).filter((l) => l.trim());
  const rest = sec.slice(k + 1).filter((l) => l.trim());
  const bullets = rest.filter((l) => l.startsWith('[ListBullet'));
  const suit = rest.find((l) => /^\[[^\]]*\] Suitable for:/.test(l));
  const care = rest.find((l) => /^\[[^\]]*\] Care & Use:/.test(l));
  if (!title || !meta) problems.push(`${sku}: no SEO title/meta`);
  if (title.length > 60) problems.push(`${sku}: title ${title.length} — ${title}`);
  if (meta.length > 160 || (meta && !/[.!]$/.test(meta))) problems.push(`${sku}: meta ${meta.length}`);
  if (titles.has(title)) problems.push(`${sku}: duplicate title with ${titles.get(title)}`);
  titles.set(title, sku);
  out.push(head, `[b] SKU: ${sku}`, '[Heading2] Product Description', `[b] ${body(paras[0])}`, ...paras.slice(1).map((p) => `[] ${body(p)}`),
    '[Heading2] Key Features', ...bullets.map((b) => `[ListBullet,b] ${body(b)}`),
    ...(suit ? [`[b] ${body(suit)}`] : []), ...(care ? [`[b] ${body(care)}`] : []),
    '[Heading2] SEO Title', `[] ${title}`, '[Heading2] Meta Description', `[] ${meta}`,
    ...(search ? ['[Heading2] Search Phrases', `[] ${search}`] : []));
}
writeFileSync(OUT, out.join('\n'));
console.log(`${OUT}: ${titles.size} product(s)`);
if (problems.length) { console.log('PROBLEMS:\n  ' + problems.join('\n  ')); process.exitCode = 1; }
