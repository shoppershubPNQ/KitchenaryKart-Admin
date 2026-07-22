/**
 * Collections endpoint.
 *
 * GET /api/collections — returns the curated collections (`bestsellers`,
 * `new-arrivals`) plus a flat list of every **active** product the admin can
 * pick from (sku, name, category, subcategory, image, price).
 *
 * Products WITHOUT a category/subcategory are deliberately INCLUDED — the
 * storefront curates the home tabs by SKU (not by category), so those products
 * can be featured too. An earlier version filtered them out, which hid ~60
 * products from the picker.
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

    const [collections, rows] = await Promise.all([
      prisma.collection.findMany({ orderBy: { id: 'asc' } }),
      prisma.product.findMany({
        where: { status: 'active' },
        select: {
          sku: true,
          name: true,
          category: true,
          subcategory: true,
          imageUrl: true,
          price: true,
        },
        orderBy: [{ name: 'asc' }],
      }),
    ]);

    const products = rows.map((p) => ({
      sku: p.sku,
      name: p.name,
      category: p.category, // may be null — the picker labels these "Uncategorized"
      subcategory: p.subcategory, // may be null
      imageUrl: p.imageUrl,
      price: Number(p.price),
    }));

    return ok({ collections, products });
  } catch (e) {
    return handleError(e);
  }
});
