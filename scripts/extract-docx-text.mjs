/** Extract the owner's .docx files into the line format the apply-* scripts read.
 *
 *  One line per paragraph, prefixed with its Word style and run flags:
 *      [Heading1] 1. Electric popcorn machine — KKHE0100-PC01
 *      [ListBullet,b] Capacity: 8 oz kettle
 *      [] plain paragraph
 *      [TBL] cell | cell | cell            (one line per table row)
 *
 *  Style names are taken from w:pStyle; "b" is added when the paragraph's
 *  first run is bold, which is how the owner marks run-in labels. Table rows
 *  are flattened so the contents list at the top of each doc stays readable.
 *
 *  Usage: node scripts/extract-docx-text.mjs <in.docx> [out.txt]
 *  Writes scripts/docs/<name>.txt when no output path is given.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const [, , IN, OUT] = process.argv;
if (!IN) {
  console.error('Usage: node scripts/extract-docx-text.mjs <in.docx> [out.txt]');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const outPath = OUT || join(here, 'docs', basename(IN).replace(/\.docx$/i, '') + '.txt');

const zip = await JSZip.loadAsync(readFileSync(resolve(IN)));
const xml = await zip.file('word/document.xml').async('string');

/** Word stores literal text in <w:t>; <w:tab/> and <w:br/> are whitespace. */
function textOf(frag) {
  return frag
    .replace(/<w:tab\b[^>]*\/>/g, ' ')
    .replace(/<w:br\b[^>]*\/>/g, ' ')
    .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, (_, t) => t)
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function paragraph(p) {
  const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(p)?.[1] || '';
  const firstRun = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/.exec(p)?.[0] || '';
  const bold = /<w:b\b(?![^>]*w:val="(?:0|false)")[^>]*\/?>/.test(firstRun);
  const tags = [style, bold ? 'b' : ''].filter(Boolean).join(',');
  return { tags, text: textOf(p) };
}

const lines = [];
// Walk top-level blocks in document order: tables flatten to [TBL] rows,
// everything else is a paragraph.
const blocks = xml.match(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g) || [];
for (const block of blocks) {
  if (block.startsWith('<w:tbl')) {
    for (const row of block.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || []) {
      const cells = (row.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || []).map(textOf);
      if (cells.some(Boolean)) lines.push(`[TBL] ${cells.join(' | ')}`);
    }
  } else {
    const { tags, text } = paragraph(block);
    if (text) lines.push(`[${tags}] ${text}`);
  }
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
console.log(`${lines.length} lines → ${outPath}`);
