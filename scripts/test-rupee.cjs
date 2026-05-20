#!/usr/bin/env node
// Local smoke test: render a PDF with ₹ using the embedded Roboto
// fonts and dump it to disk so we can eyeball whether the glyph shows.
const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');

const REG = fs.readFileSync(path.join(__dirname, '..', 'assets/fonts/Roboto-Regular.ttf'));
const BOLD = fs.readFileSync(path.join(__dirname, '..', 'assets/fonts/Roboto-Bold.ttf'));

const doc = new PDFDocument({ size: 'A4', margin: 36 });
const out = fs.createWriteStream(path.join(__dirname, 'rupee-test.pdf'));
doc.pipe(out);

doc.registerFont('Body', REG);
doc.registerFont('Body-Bold', BOLD);

doc.font('Body').fontSize(24).text('Rupee glyph test', 36, 36);
doc.fontSize(18);
doc.text('Regular: ₹1,234.56', 36, 100);
doc.font('Body-Bold');
doc.text('Bold:    ₹1,234.56', 36, 140);

doc.end();
out.on('finish', () => {
  const size = fs.statSync(path.join(__dirname, 'rupee-test.pdf')).size;
  console.log('Wrote rupee-test.pdf,', size, 'bytes');
});
