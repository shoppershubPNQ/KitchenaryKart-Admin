/**
 * Collections endpoint.
 *
 * GET /api/collections — returns the curated collections (`bestsellers`,
 * `new-arrivals`) plus the full product tree the admin can pick from. The
 * tree is grouped category → subcategory → products so the UI can render
 * expandable subcategory rows with per-product checkboxes.
 *
 * Auto-creates the two collection rows on first call so a fresh install
 * just works.
 */
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';

const KNOWN_COLLECTIONS: { slug: string; name: string }[] = [
  { slug: 'bestsellers', name: 'Best Seller' },
  { slug: 'new-arrivals', name: 'New Arrival' },
];

export const GET = withAuth(async () => {
  try {
    // Auto-seed missing collection rows (idempotent — uses upsert).
    await Promise.all(
      KNOWN_COLLECTIONS.map((c) =>
        prisma.collection.upsert({
          where: { slug: c.slug },
          create: { slug: c.slug, name: c.name, subcategories: [], productSkus: [] },
          update: {},
        }),
      ),
    );

    const [collections, products] = await Promise.all([
      prisma.collection.findMany({ orderBy: { id: 'asc' } }),
      prisma.product.findMany({
        where: { status: 'active', category: { not: null }, subcategory: { not: null } },
        select: {
          sku: true,
          name: true,
          category: true,
          subcategory: true,
          imageUrl: true,
          price: true,
        },
        orderBy: [{ category: 'asc' }, { subcategory: 'asc' }, { name: 'asc' }],
      }),
    ]);

    interface ProductLite {
      sku: string;
      name: string;
      imageUrl: string | null;
      price: number;
    }
    interface SubNode {
      subName: string;
      products: ProductLite[];
    }
    type Tree = Record<string, SubNode[]>;

    // Pivot rows into category → subcategory → products[].
    const tree: Tree = {};
    const subIndex = new Map<string, ProductLite[]>(); // "cat||sub" → products
    for (const p of products) {
      const cat = p.category as string;
      const sub = p.subcategory as string;
      const key = `${cat}||${sub}`;
      let bucket = subIndex.get(key);
      if (!bucket) {
        bucket = [];
        subIndex.set(key, bucket);
        (tree[cat] ||= []).push({ subName: sub, products: bucket });
      }
      bucket.push({
        sku: p.sku,
        name: p.name,
        imageUrl: p.imageUrl,
        price: Number(p.price),
      });
    }

    return ok({ collections, tree });
  } catch (e) {
    return handleError(e);
  }
});
