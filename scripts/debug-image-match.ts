import fs from 'node:fs';
import path from 'node:path';

const SOURCE = 'C:/Users/sc1/Desktop/ONKAR/APP DEVLOPMENT IMAGES';

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[^a-z0-9 ]/g, '');
}
function isImageFile(name: string): boolean {
  return /\.(jpg|jpeg|png|webp|gif)$/i.test(name);
}

const folders: Array<{ key: string; original: string; path: string; fileCount: number }> = [];

function walk(dir: string) {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  const images = entries.filter(e => e.isFile() && isImageFile(e.name));
  if (images.length > 0) {
    const leafName = path.basename(dir);
    folders.push({ key: normalize(leafName), original: leafName, path: dir, fileCount: images.length });
  }
  for (const e of entries) {
    if (e.isDirectory()) walk(path.join(dir, e.name));
  }
}

walk(SOURCE);
console.log(`Total image folders: ${folders.length}`);

// Look for "electric deep fryer 4l single head"
const target = normalize('Electric Deep Fryer 4L Single Head');
const hits = folders.filter(f => f.key === target);
console.log(`Folders normalized to "${target}":`, hits.length);
hits.forEach(h => console.log('  →', h.path, `(${h.fileCount} files)`));

console.log('\nFirst 30 keys:');
folders.slice(0, 30).forEach(f => console.log(`  "${f.key}"  ←  ${f.original}`));
