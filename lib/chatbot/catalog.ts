/**
 * Read-only catalogue access for the website chatbot (search_products and
 * get_product_details), plus the formatting helpers the bot quotes from.
 *
 * Rules this file enforces (owner rules, see memory "Prices are GST-INCLUSIVE"):
 *  - Prices are GST-inclusive as stored and are quoted EXACTLY (paise shown when
 *    not .00). Nothing here computes, rounds, discounts or totals a price.
 *  - Each size has its own price: a size's absolute price wins over parent +
 *    modifier - the same rule as lib/order-items.ts (the binding charge).
 *  - Stock is only ever in_stock true/false, never a count.
 *  - Only `status: 'active'` products are ever returned. The internal cost
 *    price column is never selected.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { getAdminSearchIndex } from '../product-search-index';
import { rankItems } from '../search';

export const SITE_URL = (process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://kitchenarykart.com').replace(/\/$/, '');
/** Same shape as web/components/ProductCard.tsx links. */
export const productUrl = (sku: string) => `${SITE_URL}/product/${encodeURIComponent(sku)}`;

/**
 * "₹1,457.30", "₹2,500", "₹1,25,000" - Indian grouping done by hand (last 3
 * digits, then groups of 2) so it is deterministic, paise only when not 00.
 * Deliberately differs from the storefront display, which rounds to whole
 * rupees (owner decision OD-1: quote exactly as stored).
 */
export function formatInr(value: Prisma.Decimal | number | string): string {
  const d = new Prisma.Decimal(value);
  const neg = d.isNegative();
  const [int, frac] = d.abs().toFixed(2).split('.');
  const last3 = int.slice(-3);
  let rest = int.slice(0, -3);
  const groups: string[] = [];
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) groups.unshift(rest);
  const intStr = groups.length ? `${groups.join(',')},${last3}` : last3;
  return `${neg ? '-' : ''}₹${intStr}${frac === '00' ? '' : `.${frac}`}`;
}

/** Port of web/lib/seo-title.ts readableVariant: a variant value stored as a
 *  JSON object ({"Size":"40L","Capacity":"40 litre"}) reads "40L / 40 litre". */
export function readableVariant(raw: string): string {
  const s = raw.trim();
  if (!s.startsWith('{')) return s;
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === 'object') {
      const vals = [...new Set(Object.values(obj).map((x) => String(x).trim()).filter(Boolean))];
      if (vals.length) return vals.join(' / ');
    }
  } catch {
    // not JSON after all - use as-is
  }
  return s;
}

/** Copy of web/lib/brand.ts: VAMA and Veratti are the house brands; everything
 *  else is sold as Kitchenary Kart. No other brand is ever named. */
export function productBrand(productName: string | null | undefined): string {
  if (productName) {
    if (/\bvama\b/i.test(productName)) return 'VAMA';
    if (/\bveratti\b/i.test(productName)) return 'Veratti';
  }
  return 'Kitchenary Kart';
}

const PRODUCT_SELECT = {
  id: true,
  sku: true,
  name: true,
  category: true,
  price: true,
  mrp: true,
  stock: true,
  taxPercent: true,
  hsnCode: true,
  capacity: true,
  power: true,
  dimensions: true,
  weight: true,
  material: true,
  color: true,
  description: true,
  faqs: true,
  status: true,
  variants: {
    select: {
      id: true,
      skuSuffix: true,
      variantType: true,
      variantValue: true,
      price: true,
      priceModifier: true,
      mrp: true,
      stock: true,
      capacity: true,
      power: true,
      dimensions: true,
      weight: true,
      description: true,
    },
  },
} satisfies Prisma.ProductSelect;

type CatalogProduct = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

interface SizeSpecs {
  capacity?: string;
  power?: string;
  dimensions?: string;
  weight?: string;
}

interface Size {
  id: number;
  label: string | null;
  sku: string;
  price: Prisma.Decimal;
  mrp: Prisma.Decimal | null;
  inStock: boolean;
  specs: SizeSpecs;
  description: string | null;
}

function nonEmpty(v: string | null | undefined): string | undefined {
  const s = (v ?? '').trim();
  return s ? s : undefined;
}

function compactSpecs<T extends Record<string, string | undefined>>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v) (out as Record<string, string>)[k] = v;
  return out;
}

/**
 * Every size of a product. Variant products use their variants that have a
 * sku (most reuse the parent sku as one of them, so the parent is NOT added as
 * an extra size). Price: the variant's own absolute price, else parent +
 * modifier, in Decimal - never floats. MRP has no parent fallback.
 */
function sizesOf(p: CatalogProduct): Size[] {
  const withSku = p.variants.filter((v) => nonEmpty(v.skuSuffix));
  const sizes: Size[] = withSku.length
    ? withSku.map((v) => ({
        id: v.id,
        label: readableVariant(v.variantValue ?? '') || nonEmpty(v.variantType) || v.skuSuffix!.trim(),
        sku: v.skuSuffix!.trim(),
        price: v.price ?? p.price.plus(v.priceModifier),
        mrp: v.mrp,
        inStock: v.stock > 0,
        specs: compactSpecs({
          capacity: nonEmpty(v.capacity),
          power: nonEmpty(v.power),
          dimensions: nonEmpty(v.dimensions),
          weight: nonEmpty(v.weight),
        }),
        description: nonEmpty(v.description) ?? null,
      }))
    : [
        {
          id: 0,
          label: null,
          sku: p.sku,
          price: p.price,
          mrp: p.mrp,
          inStock: p.stock > 0,
          specs: {},
          description: null,
        },
      ];
  return sizes.sort((a, b) => a.price.comparedTo(b.price) || a.id - b.id);
}

const priced = (s: Size) => s.price.greaterThan(0);

function sizeOut(s: Size) {
  return {
    size: s.label,
    sku: s.sku,
    price_display: priced(s) ? formatInr(s.price) : null,
    ...(priced(s) ? {} : { price_on_request: true as const }),
    in_stock: s.inStock,
    url: productUrl(s.sku),
  };
}

function priceRange(sizes: Size[]): string | null {
  const p = sizes.filter(priced).map((s) => s.price);
  if (!p.length) return null;
  const min = Prisma.Decimal.min(...p);
  const max = Prisma.Decimal.max(...p);
  return min.equals(max) ? formatInr(min) : `${formatInr(min)} – ${formatInr(max)}`;
}

/** Plain text from stored HTML, cut on a word boundary. */
function plainText(html: string, max: number): string {
  const s = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d{1,6});/g, (_m, c: string) => {
      const n = Number(c);
      return n > 31 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
    })
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trim()}…`;
}

function cleanFaqs(raw: unknown): Array<{ q: string; a: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ q: string; a: string }> = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const q = (f as { q?: unknown }).q;
    const a = (f as { a?: unknown }).a;
    if (typeof q !== 'string' || typeof a !== 'string' || !q.trim() || !a.trim()) continue;
    out.push({ q: plainText(q, 200), a: plainText(a, 400) });
    if (out.length >= 5) break;
  }
  return out;
}

// --------------------------------------------------------------- search

/** Storefront search first (Hindi, Hinglish, synonyms and ALT words for free). */
async function storefrontSkus(q: string, fetchImpl: typeof fetch): Promise<string[] | null> {
  try {
    const res = await fetchImpl(`${SITE_URL}/api/search?q=${encodeURIComponent(q)}&limit=12`, {
      headers: { 'user-agent': 'kk-admin-chatbot' },
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { hits?: Array<{ sku?: unknown }>; error?: unknown };
    if (body?.error || !Array.isArray(body?.hits)) return null;
    return body.hits.map((h) => (typeof h?.sku === 'string' ? h.sku : '')).filter(Boolean);
  } catch {
    return null;
  }
}

/** Fallback: the admin's own fuzzy index (no Hindi, better than nothing). */
async function localSkus(q: string): Promise<string[]> {
  const index = await getAdminSearchIndex();
  return rankItems(index.filter((r) => r.status === 'active'), q)
    .slice(0, 12)
    .map((r) => r.sku);
}

export interface SearchOptions {
  /** Test hook: replace the storefront fetch (e.g. one that always fails). */
  fetchImpl?: typeof fetch;
}

export async function searchCatalog(query: string, opts: SearchOptions = {}) {
  const q = query.trim();
  if (q.length < 3) {
    return { ok: true as const, query: q, results: [], note: 'Query too short - ask the customer for the product name.' };
  }

  const skus = (await storefrontSkus(q, opts.fetchImpl ?? fetch)) ?? (await localSkus(q));
  if (!skus.length) {
    return { ok: true as const, query: q, results: [], note: 'All prices include GST. Copy price_display exactly.' };
  }

  const [parents, variants] = await Promise.all([
    prisma.product.findMany({ where: { sku: { in: skus }, status: 'active' }, select: { id: true, sku: true } }),
    prisma.productVariant.findMany({
      where: { skuSuffix: { in: skus }, product: { status: 'active' } },
      select: { skuSuffix: true, productId: true },
    }),
  ]);
  // A variant mapping wins over a parent (same rule as resolveOrderItems).
  const bySku = new Map<string, { productId: number; matched: string | null }>();
  for (const p of parents) bySku.set(p.sku, { productId: p.id, matched: null });
  for (const v of variants) if (v.skuSuffix) bySku.set(v.skuSuffix, { productId: v.productId, matched: v.skuSuffix });

  const picked: Array<{ productId: number; matched: string | null }> = [];
  const seen = new Set<number>();
  for (const s of skus) {
    const m = bySku.get(s);
    if (!m || seen.has(m.productId)) continue;
    seen.add(m.productId);
    picked.push(m);
    if (picked.length >= 5) break;
  }

  const rows = await prisma.product.findMany({
    where: { id: { in: picked.map((p) => p.productId) }, status: 'active' },
    select: PRODUCT_SELECT,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  const results = picked.flatMap(({ productId, matched }) => {
    const p = byId.get(productId);
    if (!p) return [];
    const sizes = sizesOf(p);
    return [
      {
        product_ref: p.sku,
        name: p.name,
        brand: productBrand(p.name),
        category: p.category,
        url: productUrl(p.sku),
        price_range: priceRange(sizes),
        any_in_stock: sizes.some((s) => s.inStock),
        matched_sku: matched,
        sizes: sizes.slice(0, 6).map(sizeOut),
        more_sizes: Math.max(0, sizes.length - 6),
      },
    ];
  });

  return { ok: true as const, query: q, results, note: 'All prices include GST. Copy price_display exactly.' };
}

// -------------------------------------------------------------- details

/** Active product (and size) for a sku: size sku first, then parent sku, then
 *  both again case-insensitively. */
async function locate(raw: string): Promise<{ productId: number; variantSku: string | null } | null> {
  const s = raw.trim().slice(0, 80);
  if (!s) return null;

  let v = await prisma.productVariant.findFirst({
    where: { skuSuffix: s, product: { status: 'active' } },
    select: { productId: true, skuSuffix: true },
  });
  if (v) return { productId: v.productId, variantSku: v.skuSuffix };
  let p = await prisma.product.findFirst({ where: { sku: s, status: 'active' }, select: { id: true } });
  if (p) return { productId: p.id, variantSku: null };

  v = await prisma.productVariant.findFirst({
    where: { skuSuffix: { equals: s, mode: 'insensitive' }, product: { status: 'active' } },
    select: { productId: true, skuSuffix: true },
  });
  if (v) return { productId: v.productId, variantSku: v.skuSuffix };
  p = await prisma.product.findFirst({ where: { sku: { equals: s, mode: 'insensitive' }, status: 'active' }, select: { id: true } });
  if (p) return { productId: p.id, variantSku: null };
  return null;
}

export async function productDetails(sku: string) {
  const hit = await locate(sku);
  if (!hit) return { ok: true as const, found: false as const };
  const p = await prisma.product.findFirst({ where: { id: hit.productId, status: 'active' }, select: PRODUCT_SELECT });
  if (!p) return { ok: true as const, found: false as const };

  const sizes = sizesOf(p).slice(0, 40);
  const selectedSku = hit.variantSku?.trim() || null;
  const selected = selectedSku ? sizes.find((s) => s.sku === selectedSku) ?? null : null;
  const rawDescription = selected?.description ?? nonEmpty(p.description) ?? null;

  return {
    ok: true as const,
    found: true as const,
    product_ref: p.sku,
    selected_sku: selectedSku,
    name: p.name,
    brand: productBrand(p.name),
    category: p.category,
    url: productUrl(selectedSku ?? p.sku),
    gst_percent: Number(p.taxPercent),
    hsn_code: p.hsnCode ?? null,
    sizes: sizes.map((s) => ({
      ...sizeOut(s),
      mrp_display: s.mrp && s.mrp.greaterThan(0) ? formatInr(s.mrp) : null,
      ...(Object.keys(s.specs).length ? { specs: s.specs } : {}),
    })),
    specs: compactSpecs({
      capacity: nonEmpty(p.capacity),
      power: nonEmpty(p.power),
      dimensions: nonEmpty(p.dimensions),
      weight: nonEmpty(p.weight),
      material: nonEmpty(p.material),
      color: nonEmpty(p.color),
    }),
    description: rawDescription ? plainText(rawDescription, 700) : null,
    faqs: cleanFaqs(p.faqs),
    note: 'All prices include GST. Copy price_display exactly. Never give stock quantities.',
  };
}

/** For the "[Website context]" block: which active product (and size) a
 *  product-page sku is. Null when it does not resolve. */
export async function resolveActive(sku: string): Promise<{ name: string; sizeLabel: string | null; sku: string } | null> {
  const hit = await locate(sku);
  if (!hit) return null;
  const p = await prisma.product.findFirst({ where: { id: hit.productId, status: 'active' }, select: PRODUCT_SELECT });
  if (!p) return null;
  if (hit.variantSku) {
    const size = sizesOf(p).find((s) => s.sku === hit.variantSku!.trim());
    return { name: p.name, sizeLabel: size?.label ?? null, sku: hit.variantSku.trim() };
  }
  return { name: p.name, sizeLabel: null, sku: p.sku };
}

/**
 * For the "[Website photo context]" block: the photo-search SKUs the widget
 * sent (already shape-checked by photo.ts cleanHintSkus), re-validated here.
 * EXACT sku matches on ACTIVE products only (no case-insensitive fallback - a
 * hint is not a typed code), a size sku mapping wins over a parent sku (same
 * rule as searchCatalog), one entry per product, in the widget's order.
 * Names and size labels come from the database, never from the request.
 */
export async function resolvePhotoHints(skus: string[]): Promise<Array<{ sku: string; name: string; sizeLabel: string | null }>> {
  if (!skus.length) return [];
  const [parents, variants] = await Promise.all([
    prisma.product.findMany({ where: { sku: { in: skus }, status: 'active' }, select: { id: true, sku: true, name: true } }),
    prisma.productVariant.findMany({
      where: { skuSuffix: { in: skus }, product: { status: 'active' } },
      select: { skuSuffix: true, productId: true, variantType: true, variantValue: true, product: { select: { name: true } } },
    }),
  ]);
  const bySku = new Map<string, { productId: number; name: string; sizeLabel: string | null }>();
  for (const p of parents) bySku.set(p.sku, { productId: p.id, name: p.name, sizeLabel: null });
  for (const v of variants) {
    if (!v.skuSuffix) continue;
    const label = readableVariant(v.variantValue ?? '') || nonEmpty(v.variantType) || null;
    bySku.set(v.skuSuffix, { productId: v.productId, name: v.product.name, sizeLabel: label });
  }
  const out: Array<{ sku: string; name: string; sizeLabel: string | null }> = [];
  const seen = new Set<number>();
  for (const s of skus) {
    const m = bySku.get(s);
    if (!m || seen.has(m.productId)) continue;
    seen.add(m.productId);
    out.push({ sku: s, name: m.name, sizeLabel: m.sizeLabel });
  }
  return out;
}
