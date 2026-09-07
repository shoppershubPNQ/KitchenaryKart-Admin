import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok, paging } from '@/lib/api';
import { rankItems } from '@/lib/search';
import { getAdminSearchIndex, invalidateAdminSearchIndex, codeKey } from '@/lib/product-search-index';

const createSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  leafCategory: z.string().optional(),
  price: z.number().nonnegative(),
  costPrice: z.number().nonnegative().optional(),
  mrp: z.number().nonnegative().optional(),
  taxPercent: z.number().nonnegative().optional(),
  discountPercent: z.number().nonnegative().optional(),
  dimensions: z.string().optional(),
  power: z.string().optional(),
  capacity: z.string().optional(),
  weight: z.string().optional(),
  material: z.string().optional(),
  color: z.string().optional(),
  stock: z.number().int().nonnegative().optional(),
  reorderPoint: z.number().int().nonnegative().optional(),
  hsnCode: z.string().optional(),
  status: z.enum(['active', 'draft', 'discontinued']).optional(),
  imageUrl: z.string().url().optional(),
  images: z.array(z.string().url()).optional(),
  isBestseller: z.boolean().optional(),
  isNewArrival: z.boolean().optional(),
});

export const GET = withAuth(async (req) => {
  try {
    const url = new URL(req.url);
    const { limit, offset } = paging(url);
    const category = url.searchParams.get('category') || undefined;
    const status = url.searchParams.get('status') || undefined;
    const search = url.searchParams.get('search')?.trim();
    const lowStock = url.searchParams.get('lowStock') === '1';
    const images = url.searchParams.get('images') || undefined;

    const where: Prisma.ProductWhereInput = {};
    if (category) where.category = category;
    if (status) where.status = status as any;

    // SMART SEARCH — the same fuzzy ranker the storefront uses (lib/search.ts),
    // so a query that finds a product on the shop page finds it here too. The
    // old `contains` ILIKE was exact-substring only: one typo returned nothing,
    // and a multi-word query missed unless a single column held that exact
    // string. Ranked in memory over a cached index; pasting a variant sku still
    // lands on the parent that owns it.
    let rankedIds: number[] | null = null;
    if (search) {
      const index = await getAdminSearchIndex();
      // Exact sku substring FIRST — a pasted code either appears in a sku or it
      // does not, and that certainty must outrank any similarity score.
      const needle = search.toLowerCase();
      const exact = index.filter((r) => r.skuBlob.includes(needle)).map((r) => r.id);

      // Then MODEL CODES held in the keywords ("HS-1TS" for the 1AMS oven).
      // Only for code-shaped queries — matched on the punctuation-stripped key
      // so "HS-1TS", "HS 1TS" and "HS1TS" all hit. Guarded by the digit test so
      // an ordinary word ("hotel", "commercial") cannot exact-match every
      // product through its boilerplate keywords.
      const key = codeKey(search);
      const codeLike = key.length >= 4 && /[0-9]/.test(key) && /[a-z]/.test(key);
      const byAlias = codeLike
        ? index.filter((r) => r.aliasBlob.split(' ').includes(key)).map((r) => r.id)
        : [];

      const fuzzy = rankItems(index, search).map((r) => r.id);
      rankedIds = [...new Set([...exact, ...byAlias, ...fuzzy])];
      if (rankedIds.length === 0) return ok({ products: [], total: 0, limit, offset });
    }

    // id restrictions can come from BOTH search and lowStock — intersect them
    // rather than letting the second overwrite the first.
    let idFilter: number[] | null = rankedIds;
    if (lowStock) {
      // Raw comparison — Prisma can't compare two columns.
      const rows = await prisma.$queryRaw<{ id: number }[]>`
        SELECT id FROM products WHERE stock <= reorder_point
      `;
      const low = rows.map((x) => x.id);
      idFilter = idFilter ? idFilter.filter((id) => low.includes(id)) : low;
      if (idFilter.length === 0) return ok({ products: [], total: 0, limit, offset });
    }

    // PICTURES — the three questions the photographer's list needs answered,
    // which the JSON gallery column keeps Prisma from asking:
    //   no_cover   the product's OWN gallery is empty, whatever its variants carry
    //   variants   at least one variant has no picture of its own (it falls
    //              back to the parent's on the site, so this is the size that
    //              is shown with the wrong photo)
    //   none       not one picture anywhere — cover or variant
    if (images === 'no_cover' || images === 'variants' || images === 'none') {
      const rows =
        images === 'no_cover'
          ? await prisma.$queryRaw<{ id: number }[]>`
              SELECT id FROM products p
              WHERE (p.image_url IS NULL OR p.image_url = '')
                AND (p.images IS NULL OR jsonb_typeof(p.images) <> 'array' OR jsonb_array_length(p.images) = 0)
            `
          : images === 'variants'
            ? await prisma.$queryRaw<{ id: number }[]>`
              SELECT DISTINCT p.id FROM products p
              JOIN product_variants v ON v.product_id = p.id
              WHERE (v.image_url IS NULL OR v.image_url = '')
                AND (v.images IS NULL OR jsonb_typeof(v.images) <> 'array' OR jsonb_array_length(v.images) = 0)
            `
            : await prisma.$queryRaw<{ id: number }[]>`
              SELECT id FROM products p
              WHERE (p.image_url IS NULL OR p.image_url = '')
                AND (p.images IS NULL OR jsonb_typeof(p.images) <> 'array' OR jsonb_array_length(p.images) = 0)
                AND NOT EXISTS (
                  SELECT 1 FROM product_variants v
                  WHERE v.product_id = p.id
                    AND ((v.image_url IS NOT NULL AND v.image_url <> '')
                      OR (v.images IS NOT NULL AND jsonb_typeof(v.images) = 'array' AND jsonb_array_length(v.images) > 0))
                )
            `;
      const bare = rows.map((x) => x.id);
      idFilter = idFilter ? idFilter.filter((id) => bare.includes(id)) : bare;
      if (idFilter.length === 0) return ok({ products: [], total: 0, limit, offset });
    }
    if (idFilter) where.id = { in: idFilter };

    // With a search active the ORDER is the ranking, so the page has to be
    // sliced from the ranked list — an `orderBy` in SQL would throw the
    // relevance away and hand back an arbitrary 25.
    if (rankedIds) {
      const matching = await prisma.product.findMany({ where, select: { id: true } });
      const allowed = new Set(matching.map((m) => m.id));
      const ordered = rankedIds.filter((id) => allowed.has(id));
      const pageIds = ordered.slice(offset, offset + limit);
      const rows = pageIds.length
        ? await prisma.product.findMany({
            where: { id: { in: pageIds } },
            include: { _count: { select: { variants: true } } },
          })
        : [];
      const byId = new Map(rows.map((r) => [r.id, r]));
      const products = pageIds.map((id) => byId.get(id)).filter(Boolean);
      return ok({ products, total: ordered.length, limit, offset });
    }

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
        include: { _count: { select: { variants: true } } },
      }),
      prisma.product.count({ where }),
    ]);

    return ok({ products: items, total, limit, offset });
  } catch (e) {
    return handleError(e);
  }
});

/** Human-friendly auto ID derived from the primary key: 54 -> "PID-00054".
 *  Guaranteed unique (the id is), never edited by the admin. */
function makeProductCode(id: number): string {
  return `PID-${String(id).padStart(5, '0')}`;
}

export const POST = withAuth(async (req, { user }) => {
  try {
    const body = createSchema.parse(await req.json());
    const { images, ...rest } = body;
    // Create first to obtain the auto-increment id, then stamp the derived
    // productCode so the two identifiers stay in lockstep.
    const created = await prisma.product.create({
      data: {
        ...rest,
        images: images as any,
        createdById: user.id,
      },
    });
    const product = await prisma.product.update({
      where: { id: created.id },
      data: { productCode: makeProductCode(created.id) },
    });
    // A brand-new product must be findable immediately, not after the TTL.
    invalidateAdminSearchIndex();
    return ok({ product }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);
