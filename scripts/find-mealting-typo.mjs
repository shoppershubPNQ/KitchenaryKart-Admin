// Find all DB rows containing the "Mealting" typo across products,
// variants, categories, collections, reels, banners.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const NEEDLE = 'mealting';
const like = `%${NEEDLE}%`;

console.log(`\n=== Products (name/description/meta_*/category/subcategory/leaf_category) ===`);
const products = await prisma.$queryRaw`
  SELECT id, sku, name, description, category, subcategory, leaf_category,
         meta_title, meta_description, meta_keywords
  FROM products
  WHERE name ILIKE ${like}
     OR description ILIKE ${like}
     OR category ILIKE ${like}
     OR subcategory ILIKE ${like}
     OR leaf_category ILIKE ${like}
     OR meta_title ILIKE ${like}
     OR meta_description ILIKE ${like}
     OR meta_keywords ILIKE ${like}
  ORDER BY id
`;
console.log(`Matches: ${products.length}`);
for (const p of products) {
  console.log(JSON.stringify(p, null, 2));
}

console.log(`\n=== Product Variants (variant_type/variant_value) ===`);
const variants = await prisma.$queryRaw`
  SELECT pv.id, pv.product_id, p.sku AS parent_sku, pv.sku_suffix,
         pv.variant_type, pv.variant_value
  FROM product_variants pv
  JOIN products p ON p.id = pv.product_id
  WHERE pv.variant_type ILIKE ${like}
     OR pv.variant_value ILIKE ${like}
  ORDER BY pv.id
`;
console.log(`Matches: ${variants.length}`);
for (const v of variants) console.log(JSON.stringify(v));

console.log(`\n=== Categories (name/description) ===`);
const cats = await prisma.$queryRaw`
  SELECT id, name, slug, description
  FROM categories
  WHERE name ILIKE ${like} OR description ILIKE ${like}
`;
console.log(`Matches: ${cats.length}`);
for (const c of cats) console.log(JSON.stringify(c));

console.log(`\n=== Collections ===`);
try {
  const cols = await prisma.$queryRaw`
    SELECT id, name, description
    FROM collections
    WHERE name ILIKE ${like} OR description ILIKE ${like}
  `;
  console.log(`Matches: ${cols.length}`);
  for (const c of cols) console.log(JSON.stringify(c));
} catch (e) { console.log(`(skipped: ${e.message})`); }

console.log(`\n=== Reels (title/caption) ===`);
try {
  const reels = await prisma.$queryRaw`
    SELECT id, title, caption
    FROM reels
    WHERE title ILIKE ${like} OR caption ILIKE ${like}
  `;
  console.log(`Matches: ${reels.length}`);
  for (const r of reels) console.log(JSON.stringify(r));
} catch (e) { console.log(`(skipped: ${e.message})`); }

console.log(`\n=== Banners (title/subtitle/cta) ===`);
try {
  const banners = await prisma.$queryRaw`
    SELECT id, title, subtitle, cta_text
    FROM banners
    WHERE title ILIKE ${like} OR subtitle ILIKE ${like} OR cta_text ILIKE ${like}
  `;
  console.log(`Matches: ${banners.length}`);
  for (const b of banners) console.log(JSON.stringify(b));
} catch (e) { console.log(`(skipped: ${e.message})`); }

console.log(`\n=== Reviews ===`);
try {
  const reviews = await prisma.$queryRaw`
    SELECT id, product_id, title, body
    FROM reviews
    WHERE title ILIKE ${like} OR body ILIKE ${like}
  `;
  console.log(`Matches: ${reviews.length}`);
  for (const r of reviews) console.log(JSON.stringify(r));
} catch (e) { console.log(`(skipped: ${e.message})`); }

await prisma.$disconnect();
