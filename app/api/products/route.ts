import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok, paging } from '@/lib/api';
import { rankItems } from '@/lib/search';
import { getAdminSearchIndex, invalidateAdminSearchIndex, codeKey } from '@/lib/product-search-index';
import { partnerPricesFor } from '@/lib/sync-consumer';
import { heSizePrice, isKept, marginFor, readHeSizes } from '@/lib/he-price-watch';

/**
 * Hang what Hotelic Essentials charges off each row, so the list can show
 * their price beside ours. No call to them on a page load.
 *
 * Per SIZE (owner, 16 Oct 2026): the nightly scan keeps one price per HE
 * listing, but HE prices each colour/size separately — the Triple Head lamp
 * warmer showed HE ₹15,750 against our ₹26,462 Silver and an amber "→ ₹24,161"
 * although every size matched HE exactly. So each size is compared with ITS
 * own HE price from the daily HE price check (lib/he-price-watch.ts), and the
 * row shows the HE price of the size that shares the listing's SKU.
 *
 * `drifted` now means only "HE's rule price is above ours" on at least one
 * size — the case the owner acts on. HE being lower is deliberate (prices are
 * only ever raised, never lowered) and no longer flagged.
 */
async function withPartnerPrice<T extends { id: number; sku: string; price: unknown; taxPercent?: unknown; category?: string | null }>(
  products: T[],
) {
  if (products.length === 0) return products;
  const gstBySku = new Map(
    products.map((p) => [p.sku, p.taxPercent == null ? 18 : Number(p.taxPercent)]),
  );
  const [prices, heSizes, variants] = await Promise.all([
    partnerPricesFor(products.map((p) => p.sku), gstBySku),
    readHeSizes(),
    prisma.productVariant.findMany({
      where: { productId: { in: products.map((p) => p.id) } },
      select: { productId: true, skuSuffix: true, price: true, priceModifier: true },
    }),
  ]);
  const sizesOf = new Map<number, { sku: string; ours: number }[]>();
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const v of variants) {
    const p = byId.get(v.productId);
    if (!p || !v.skuSuffix) continue;
    // The price the customer is charged: an absolute size price wins over parent + modifier.
    const ours = v.price != null ? Number(v.price) : Number(p.price) + Number(v.priceModifier ?? 0);
    const list = sizesOf.get(v.productId) ?? [];
    list.push({ sku: v.skuSuffix, ours });
    sizesOf.set(v.productId, list);
  }

  return products.map((p) => {
    const linked = prices.get(p.sku) ?? null;
    const gst = gstBySku.get(p.sku) ?? 18;
    const rows = sizesOf.get(p.id) ?? [{ sku: p.sku, ours: Number(p.price) }];
    const matched = heSizes
      ? rows
          .map((r) => ({ ...r, he: heSizePrice(heSizes.sizes[r.sku.toUpperCase()], gst, r.ours, isKept(r.sku, p.sku), marginFor(p.category)) }))
          .filter((r): r is typeof r & { he: NonNullable<typeof r.he> } => r.he !== null)
      : [];

    if (!matched.length) {
      // No per-size HE price (before the first daily check, HE's GST differs from ours, or HE does not list
      // it): keep showing the scan's figure, but only flag a single-price listing — a listing-level HE price
      // says nothing reliable about a product sold in sizes.
      if (!linked) return { ...p, partner: null };
      const drifted = rows.length === 1 && linked.landed_price !== null && linked.landed_price - Number(p.price) > 1;
      return { ...p, partner: { ...linked, drifted, below_sizes: drifted ? 1 : 0, sizes_compared: drifted ? 1 : 0 } };
    }

    const own = matched.find((r) => r.sku.toUpperCase() === p.sku.toUpperCase()) ?? matched[0];
    const below = matched.filter((r) => r.he.below);
    // The amber line shows the size furthest below HE's rule price.
    const worst = below.sort((a, b) => b.he.target - b.ours - (a.he.target - a.ours))[0];
    const show = worst ?? own;
    return {
      ...p,
      partner: {
        sku: linked?.sku ?? p.sku,
        price: own.he.heIncl,
        price_ex_gst: own.he.heEx,
        marked_ex_gst: show.he.marked,
        chain_mrp: Math.round(show.he.target * 2 * 100) / 100,
        chain_note: `${show.sku}: HE ₹${show.he.heEx} ex-GST × ${marginFor(p.category).toFixed(2)} = ₹${show.he.marked} + ${gst}% GST = ₹${show.he.target}`,
        landed_price: show.he.target,
        stock: linked?.stock ?? null,
        drifted: below.length > 0,
        below_sizes: below.length,
        sizes_compared: matched.length,
        scanned_at: heSizes?.checkedAt ?? linked?.scanned_at ?? null,
      },
    };
  });
}

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
  // Hand-written search-result title and snippet. Blank = the storefront
  // generates them from the name and description (see web/lib/seo-title.ts).
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
  metaKeywords: z.string().optional(),
  // ALT words — other names customers search the product by (comma-separated).
  searchAliases: z.string().max(2000).nullable().optional(),
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
      const products = pageIds
        .map((id) => byId.get(id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p));
      return ok({
        products: await withPartnerPrice(products),
        total: ordered.length,
        limit,
        offset,
      });
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

    return ok({ products: await withPartnerPrice(items), total, limit, offset });
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
