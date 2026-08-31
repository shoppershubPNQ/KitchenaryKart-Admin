/**
 * Cached, variant-flattened index for the ADMIN product search.
 *
 * The list used to filter with `contains` ILIKE, which is exact-substring only:
 * a single typo ("kettel", "stemer") returned nothing, and a query that spanned
 * words ("gold steamer 34") missed because no single column contains that
 * string. The storefront already solved this with a fuzzy ranker; this feeds
 * the SAME ranker (lib/search.ts) so a query that finds a product on the shop
 * page finds it in the admin too.
 *
 * Indexed per PARENT product — the list view is one row per parent — but each
 * parent carries its variants' skus and values in `metaKeywords`, so pasting a
 * variant sku still lands on the parent that owns it (the old behaviour, kept).
 *
 * ~1,500 rows, so ranking in memory is far cheaper than the round trips a
 * per-keystroke DB query costs. Cached briefly because the products page
 * debounces at 250ms and an admin typing a sku fires several queries.
 */
import { prisma } from './db';
import type { Searchable } from './search';

export interface AdminSearchRow extends Searchable {
  id: number;
  sku: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  metaKeywords: string | null;
  stock: number;
  status: string;
  /**
   * Lowercased parent sku + every variant sku, for an EXACT substring pass
   * that runs before fuzzy ranking. Pasting a partial sku ("KKHE0066") is the
   * single most common admin search, and pure fuzzy scoring buried it under
   * unrelated products — a code either contains the string or it does not, so
   * that match must not be left to a similarity score.
   */
  skuBlob: string;
}

const TTL_MS = 60_000;
let cache: { at: number; rows: AdminSearchRow[] } | null = null;

/** Drop the cache after a write so a rename/new product is searchable at once. */
export function invalidateAdminSearchIndex(): void {
  cache = null;
}

export async function getAdminSearchIndex(): Promise<AdminSearchRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;

  const products = await prisma.product.findMany({
    select: {
      id: true, sku: true, name: true, category: true, subcategory: true,
      metaKeywords: true, stock: true, status: true,
      variants: { select: { skuSuffix: true, variantValue: true } },
    },
  });

  const rows: AdminSearchRow[] = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    subcategory: p.subcategory,
    // Fold the variants' skus + values into the keyword field the ranker
    // already scores, so "CMRSG2.34" or "34cm" reaches the parent row.
    metaKeywords: [
      p.metaKeywords ?? '',
      ...p.variants.map((v) => `${v.skuSuffix ?? ''} ${v.variantValue ?? ''}`),
    ].join(' ').trim() || null,
    stock: p.stock,
    status: p.status,
    skuBlob: [p.sku, ...p.variants.map((v) => v.skuSuffix ?? '')]
      .filter(Boolean).join(' ').toLowerCase(),
  }));

  cache = { at: Date.now(), rows };
  return rows;
}
