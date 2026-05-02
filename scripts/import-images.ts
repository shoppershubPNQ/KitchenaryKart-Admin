/**
 * One-time import: walks the "APP DEVLOPMENT IMAGES" folder,
 * matches sub-folders to products by name, copies images into
 * website/images/{sku}/ and populates imageUrl + images in the DB.
 *
 * Run with: npx tsx scripts/import-images.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const SOURCE = process.env.IMAGES_SRC || 'C:/Users/sc1/Desktop/ONKAR/APP DEVLOPMENT IMAGES';
const DEST = path.resolve(__dirname, '../../website/images');

const prisma = new PrismaClient();

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[^a-z0-9 ]/g, '');
}

function isImageFile(name: string): boolean {
  return /\.(jpg|jpeg|png|webp|gif)$/i.test(name);
}

/**
 * Walk a folder tree; call `onLeaf(folderPath, imageFiles[])` for every folder that directly contains images.
 *
 * Uses fs.statSync instead of Dirent.isFile() because OneDrive-synced files have reparse points
 * that cause Dirent.isFile() / isDirectory() to return false on Windows.
 */
function walk(dir: string, onLeaf: (folder: string, images: string[]) => void) {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  const images: string[] = [];
  const subdirs: string[] = [];
  for (const name of names) {
    const full = path.join(dir, name);
    let st: fs.Stats;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isFile() && isImageFile(name)) images.push(name);
    else if (st.isDirectory()) subdirs.push(name);
  }
  if (images.length > 0) onLeaf(dir, images);
  for (const sub of subdirs) walk(path.join(dir, sub), onLeaf);
}

function sortImages(files: string[]): string[] {
  // Numeric-aware sort: "1.png" before "10.jpg"
  return [...files].sort((a, b) => {
    const na = parseInt(a);
    const nb = parseInt(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(`Source folder not found: ${SOURCE}`);
  }
  console.log(`Scanning ${SOURCE}…`);

  // Build map: normalized product name → { folder, images[] }
  const nameMap = new Map<string, { folder: string; images: string[] }>();
  walk(SOURCE, (folder, images) => {
    const leafName = path.basename(folder);
    const key = normalize(leafName);
    if (!key) return;
    // Skip top-level category/subcategory folders that happen to contain stray marketing images
    // by preferring the most specific match for a given key (longest path wins).
    const existing = nameMap.get(key);
    if (!existing || folder.length > existing.folder.length) {
      nameMap.set(key, { folder, images: sortImages(images) });
    }
  });
  console.log(`Found ${nameMap.size} image folders.`);

  const products = await prisma.product.findMany({
    select: { id: true, sku: true, name: true },
  });
  console.log(`Matching against ${products.length} products…`);

  // Clean + re-create destination
  if (!fs.existsSync(DEST)) fs.mkdirSync(DEST, { recursive: true });

  let matched = 0;
  let copied = 0;
  const unmatched: string[] = [];

  for (const p of products) {
    const key = normalize(p.name);
    const entry = nameMap.get(key);
    if (!entry) {
      unmatched.push(p.name);
      continue;
    }
    matched++;

    const targetDir = path.join(DEST, p.sku);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const imageUrls: string[] = [];
    for (let i = 0; i < entry.images.length; i++) {
      const src = path.join(entry.folder, entry.images[i]);
      const ext = path.extname(entry.images[i]).toLowerCase();
      const destName = `${i + 1}${ext}`;
      const destPath = path.join(targetDir, destName);
      try {
        fs.copyFileSync(src, destPath);
        copied++;
        imageUrls.push(`/images/${encodeURIComponent(p.sku)}/${destName}`);
      } catch (e) {
        console.warn(`  copy failed: ${src} → ${destPath}`, e);
      }
    }

    await prisma.product.update({
      where: { id: p.id },
      data: {
        imageUrl: imageUrls[0] || null,
        images: imageUrls as any,
      },
    });

    if (matched % 50 === 0) process.stdout.write(`  ${matched}/${products.length}\r`);
  }

  console.log(`\n`);
  console.log(`✓ Matched: ${matched}/${products.length} products`);
  console.log(`✓ Copied:  ${copied} image files`);
  console.log(`✗ Unmatched: ${unmatched.length} products`);
  if (unmatched.length > 0 && unmatched.length <= 30) {
    console.log('  Examples of unmatched:');
    unmatched.slice(0, 30).forEach(n => console.log(`    - ${n}`));
  } else if (unmatched.length > 30) {
    console.log('  First 30 unmatched:');
    unmatched.slice(0, 30).forEach(n => console.log(`    - ${n}`));
    console.log(`  …and ${unmatched.length - 30} more`);
  }

  const unmatchedPath = path.resolve(__dirname, 'unmatched-products.txt');
  fs.writeFileSync(unmatchedPath, unmatched.join('\n'), 'utf8');
  console.log(`\nFull unmatched list saved to: ${unmatchedPath}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
