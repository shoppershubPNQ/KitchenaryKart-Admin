/**
 * Build the photo-search index: web/data/image-search-index.json.
 *
 *   cd admin && npx tsx scripts/build-image-search-index.ts
 *
 * Re-run after adding products or changing photos, then deploy web. Read-only
 * on the database; the only file it writes is the index (plus its cache).
 *
 * Each active product's main photo, second photo and every size's own photo is
 * turned into a 512-number fingerprint by MobileCLIP-S0 (fp16) — the model and
 * dtype set in web/lib/image-search-model.ts, which the customer's browser also
 * runs. (8-bit "q8" weights matched the right product type only 13% of the time
 * vs fp16's 80%, so don't "optimise" to q8.)
 *
 * The ML library is ~390 MB, so it lives OUTSIDE OneDrive, in C:/kk-ml.
 * One-time setup on a new PC:
 *   npm install --prefix C:/kk-ml @huggingface/transformers@3.8.1
 * The model downloads itself into C:/kk-ml/models on first run. Fingerprints are
 * cached by photo URL in C:/kk-ml/image-search-cache.json, so a re-run only
 * processes new photos (a full run is ~30 min).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { prisma } from '../lib/db';

/**
 * The model contract lives in web/lib/image-search-model.ts — the browser runs
 * exactly those values. Read at run time, NOT imported: admin is its own repo,
 * so a static import of ../../web would break the admin build on Vercel.
 */
function modelContract(): { MODEL: string; DTYPE: string } {
  const src = fs.readFileSync(path.resolve(__dirname, '../../web/lib/image-search-model.ts'), 'utf8');
  const MODEL = src.match(/IMAGE_MODEL_ID\s*=\s*'([^']+)'/)?.[1];
  const DTYPE = src.match(/IMAGE_MODEL_DTYPE\s*=\s*'([^']+)'/)?.[1];
  if (!MODEL || !DTYPE) throw new Error('could not read IMAGE_MODEL_ID / IMAGE_MODEL_DTYPE from web/lib/image-search-model.ts');
  return { MODEL, DTYPE };
}
const { MODEL, DTYPE } = modelContract();

const ML_DIR = process.env.KK_ML_DIR || 'C:/kk-ml';
const DIM = 512;
/** Fingerprints are only reusable for the same model, dtype and photo preparation. */
const CACHE_VERSION = `${MODEL}|${DTYPE}|w320-pad-white`;
const CACHE_FILE = path.join(ML_DIR, 'image-search-cache.json');
const OUT_FILE = path.resolve(__dirname, '../../web/data/image-search-index.json');
const CLOUDINARY = 'https://res.cloudinary.com/ddvay7jt0/image/upload';

interface Row { sku: string; variant: string | null; img: string }

/** Absolute URL for a stored photo path (mirrors web imgSrc for legacy /images/... paths). */
function absolute(img: string): string {
  if (/^https?:/i.test(img)) return img;
  const m = img.match(/^\/?images\/(.+)$/i);
  return m ? `${CLOUDINARY}/kk/${m[1]}` : img;
}
/** Catalogue photos are fingerprinted as a 320 px white square — the browser pads the customer's photo the same way. */
function square320(url: string): string {
  return url.includes('/image/upload/') ? url.replace('/image/upload/', '/image/upload/w_320,h_320,c_pad,b_white,q_auto,f_jpg/') : url;
}

async function main() {
  const ps = await prisma.product.findMany({
    where: { status: 'active' },
    // Ordered so every rebuild writes the same index for the same catalogue.
    orderBy: { sku: 'asc' },
    select: { sku: true, imageUrl: true, images: true, variants: { orderBy: { skuSuffix: 'asc' }, select: { skuSuffix: true, imageUrl: true } } },
  });
  const rows: Row[] = [];
  for (const p of ps) {
    const imgs = [...new Set([p.imageUrl, ...((p.images as string[] | null) ?? [])].filter(Boolean) as string[])];
    // The second photo helps when the first is a lifestyle shot or a collage.
    const shared = imgs.slice(0, 2);
    for (const img of shared) rows.push({ sku: p.sku, variant: null, img: absolute(img) });
    for (const v of p.variants) {
      if (v.imageUrl && v.skuSuffix && !shared.includes(v.imageUrl)) rows.push({ sku: p.sku, variant: v.skuSuffix, img: absolute(v.imageUrl) });
    }
  }
  console.log(`${ps.length} active products, ${rows.length} photos`);

  const saved = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : null;
  if (saved && saved.version !== CACHE_VERSION) console.log(`cache was made for ${saved.version ?? 'an unknown model'} — starting fresh`);
  const cache: Record<string, string> = saved?.version === CACHE_VERSION ? saved.vecs : {};
  const writeCache = () => fs.writeFileSync(CACHE_FILE, JSON.stringify({ version: CACHE_VERSION, vecs: cache }));
  const todo = rows.filter((r) => !cache[r.img]);
  console.log(`${rows.length - todo.length} cached, ${todo.length} to process`);

  if (todo.length) {
    const req = createRequire(path.join(ML_DIR, 'package.json'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t: any = req('@huggingface/transformers');
    t.env.allowLocalModels = false;
    t.env.cacheDir = path.join(ML_DIR, 'models');
    const processor = await t.AutoProcessor.from_pretrained(MODEL);
    const model = await t.CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: DTYPE });

    let done = 0, failed = 0;
    const embedOne = async (r: Row): Promise<void> => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await fetch(square320(r.img));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const image = await t.RawImage.fromBlob(await res.blob());
          const { image_embeds } = await model(await processor(image));
          const v = Array.from(image_embeds.data as Float32Array);
          const n = Math.hypot(...v);
          const q = Int8Array.from(v, (x) => Math.max(-127, Math.min(127, Math.round((x / n) * 127))));
          cache[r.img] = Buffer.from(q.buffer).toString('base64');
          done++;
          return;
        } catch (e) {
          if (attempt === 3) {
            failed++;
            console.log(`  skipped ${r.variant ?? r.sku}: ${String((e as Error).message).slice(0, 100)} — ${r.img}`);
            return;
          }
          await new Promise((ok) => setTimeout(ok, 800 * attempt));
        }
      }
    };
    const t0 = Date.now();
    for (let i = 0; i < todo.length; i += 3) {
      await Promise.all(todo.slice(i, i + 3).map(embedOne));
      if (i % 150 === 0 || i + 3 >= todo.length) {
        console.log(`  ${Math.min(i + 3, todo.length)}/${todo.length}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
        writeCache(); // survive an interrupted run
      }
    }
    writeCache();
    console.log(`processed ${done}, skipped ${failed}`);
  }

  const kept = rows.filter((r) => cache[r.img]);
  const vecs = Buffer.concat(kept.map((r) => Buffer.from(cache[r.img], 'base64')));
  if (vecs.length !== kept.length * DIM) throw new Error('fingerprint size mismatch — delete the cache and re-run');
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify({
      model: MODEL,
      dtype: DTYPE,
      dim: DIM,
      built: new Date().toISOString().slice(0, 10),
      p: kept.map((r) => r.sku),
      v: kept.map((r) => r.variant),
      vecs: vecs.toString('base64'),
    }),
  );
  const products = new Set(kept.map((r) => r.sku)).size;
  console.log(`wrote ${path.relative(process.cwd(), OUT_FILE)}: ${kept.length} photos of ${products}/${ps.length} products`);
}

main().finally(() => prisma.$disconnect());
