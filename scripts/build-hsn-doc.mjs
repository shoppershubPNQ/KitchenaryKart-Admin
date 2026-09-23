/** Build a category HSN/GST .docx in the owner's own house format.
 *
 *  One of their existing category files is the template: the zip is reused
 *  whole, so styles, fonts, header bar, footer and table look carry over
 *  untouched. Only four things change — word/document.xml (title, intro,
 *  category link, table, notes), the header's category name, the single
 *  hyperlink relationship behind the category line, and the document title in
 *  docProps. Nothing is re-created from scratch, which is why these come out
 *  identical to the ones already in the owner's folder.
 *
 *  Usage: node scripts/build-hsn-doc.mjs <spec.json> [out.docx]
 *
 *  The spec:
 *    { "title":     "Commercial Blender Category, HSN and GST",
 *      "header":    "COMMERCIAL BLENDER",          // goes in the header bar
 *      "intro":     "Twelve live products …",
 *      "link":      { "text": "Commercial Blender category reviewed on …",
 *                     "url":  "https://kitchenarykart.com/shop?cat=…" },
 *      "columns":   ["#","Model","SKU","Category","HSN code","GST"],
 *      "rows":      [["1","…","KKCE0007-BLM750WB","Cold Equipment › Blender","84198190","18%"], …],
 *      "notes":     ["GST: every SKU …", "…"] }
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import JSZip from 'jszip';

const TEMPLATE =
  'C:/Users/Admin/Downloads/HSN Code For Category/KitchenaryKart_Cotton_Candy_Machine_Category_HSN_GST.docx';

/** Column widths in twips, matching the template's own grid. */
const WIDTHS = [560, 3100, 2000, 2176, 1250, 850];
const HEADER_FILL = 'E7EDF2';
const STRIPE = ['FFFFFF', 'F6F8FA'];

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const para = (text, bold = false) =>
  `<w:p><w:r><w:rPr><w:b w:val="${bold ? '1' : '0'}"/></w:rPr>` +
  `<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

const heading = (text) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>${esc(text)}</w:t></w:r></w:p>`;

function cell(text, { width, fill, bold, center }) {
  return (
    `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${width}"/><w:vAlign w:val="center"/>` +
    `<w:shd w:fill="${fill}"/><w:tcMar>` +
    `<w:top w:w="95" w:type="dxa"/><w:left w:w="95" w:type="dxa"/>` +
    `<w:bottom w:w="95" w:type="dxa"/><w:right w:w="95" w:type="dxa"/>` +
    `</w:tcMar></w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>` +
    `<w:jc w:val="${center ? 'center' : 'left'}"/></w:pPr>` +
    `<w:r><w:rPr>${bold ? '<w:b/>' : '<w:b w:val="0"/>'}<w:sz w:val="20"/></w:rPr>` +
    `<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p></w:tc>`
  );
}

function table(columns, rows) {
  const grid = WIDTHS.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const head =
    `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>` +
    columns
      .map((c, i) => cell(c, { width: WIDTHS[i], fill: HEADER_FILL, bold: true, center: i === 0 }))
      .join('') +
    `</w:tr>`;
  const body = rows
    .map(
      (r, ri) =>
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>` +
        r
          .map((v, i) =>
            cell(v, { width: WIDTHS[i], fill: STRIPE[ri % 2], bold: false, center: i === 0 }),
          )
          .join('') +
        `</w:tr>`,
    )
    .join('');

  return (
    `<w:tbl><w:tblPr><w:tblW w:type="auto" w:w="0"/><w:jc w:val="center"/>` +
    `<w:tblLayout w:type="fixed"/>` +
    `<w:tblLook w:firstColumn="1" w:firstRow="1" w:lastColumn="0" w:lastRow="0" w:noHBand="0" w:noVBand="1" w:val="04A0"/>` +
    `<w:tblBorders>` +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((e) => `<w:${e} w:val="single" w:sz="4" w:color="D9D9D9"/>`)
      .join('') +
    `</w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${head}${body}</w:tbl>`
  );
}

const [, , SPEC, OUT] = process.argv;
if (!SPEC) {
  console.error('Usage: node scripts/build-hsn-doc.mjs <spec.json> [out.docx]');
  process.exit(1);
}
const spec = JSON.parse(readFileSync(resolve(SPEC), 'utf8'));
const out = OUT || SPEC.replace(/\.json$/i, '.docx');

const zip = await JSZip.loadAsync(readFileSync(TEMPLATE));
const original = await zip.file('word/document.xml').async('string');

// Everything before <w:body> and the closing sectPr are the template's; only
// what sits between them is ours.
const prefix = original.slice(0, original.indexOf('<w:body>') + '<w:body>'.length);
const sectPr = original.slice(original.indexOf('<w:sectPr'));

const body =
  `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>${esc(spec.title)}</w:t></w:r></w:p>` +
  para(spec.intro) +
  `<w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr></w:r>` +
  `<w:hyperlink r:id="rId11"><w:r><w:rPr><w:color w:val="225B82"/><w:sz w:val="20"/></w:rPr>` +
  `<w:t>${esc(spec.link.text)}</w:t></w:r></w:hyperlink></w:p>` +
  heading('Product index') +
  table(spec.columns, spec.rows) +
  heading('Notes') +
  spec.notes.map((n) => para(n)).join('');

zip.file('word/document.xml', prefix + body + sectPr);

// The category line's target, and nothing else: the template carries stale
// per-product hyperlink relationships that its own document never referenced.
const rels = await zip.file('word/_rels/document.xml.rels').async('string');
zip.file(
  'word/_rels/document.xml.rels',
  rels
    .replace(/<Relationship Id="rId1[2-9]"[^>]*\/>|<Relationship Id="rId[2-9]\d"[^>]*\/>/g, '')
    .replace(
      /(<Relationship Id="rId11"[^>]*Target=")[^"]*(")/,
      (_, a, b) => a + esc(spec.link.url) + b,
    ),
);

// The header bar names the category in capitals.
const header = await zip.file('word/header1.xml').async('string');
zip.file(
  'word/header1.xml',
  header.replace(
    /(<w:t[^>]*>)KITCHENARYKART[^<]*(<\/w:t>)/,
    (_, a, b) => `${a}KITCHENARYKART  |  ${esc(spec.header)} · CATEGORY, HSN &amp; GST${b}`,
  ),
);

// So the file's own properties do not still say "Cotton Candy".
const core = await zip.file('docProps/core.xml').async('string');
zip.file(
  'docProps/core.xml',
  core
    .replace(/(<dc:title>)[\s\S]*?(<\/dc:title>)/, (_, a, b) => a + esc(spec.title) + b)
    .replace(/(<dc:description>)[\s\S]*?(<\/dc:description>)/, (_, a, b) => a + esc(spec.intro) + b),
);

// DEFLATE, not JSZip's default STORE: a stored .docx is ~20x the size of the
// template it was built from, which looks like a different kind of file.
writeFileSync(
  out,
  await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }),
);
console.log(`${spec.rows.length} row(s) → ${out}`);
