import { createHash } from 'crypto';

/**
 * The wire format of the outbound catalogue feed — the single contract shared
 * with the Hotelic Essentials panel. Both sides must agree on this shape, so
 * treat it as versioned: additive changes keep SYNC_VERSION, anything that
 * removes or repurposes a field bumps it.
 *
 * Deliberately NOT included: `costPrice`. It is our internal purchase/CTC cost
 * and is documented as never leaving this system — a partner panel is still
 * "outside".
 *
 * Money travels as rupees (the unit this database stores). The consumer is
 * responsible for converting to whatever it uses internally.
 */
export const SYNC_VERSION = 1;
export const SYNC_SOURCE = 'kitchenarykart';

export interface SyncVariantPayload {
  external_id: number;
  /** Full, composed SKU — `parentSku-suffix`. Unique across the catalogue. */
  sku: string;
  sku_suffix: string | null;
  label: string;
  option_type: string | null;
  option_value: string | null;
  /** Absolute rupee price. Falls back to parent price + modifier. */
  price: number;
  mrp: number | null;
  weight: string | null;
  stock: number;
  images: string[];
}

export interface SyncProductPayload {
  external_id: number;
  sku: string;
  product_code: string | null;
  name: string;
  description: string | null;
  /** ['Category', 'Subcategory', 'Leaf'] — blanks dropped, order preserved. */
  category_path: string[];
  price: number;
  mrp: number | null;
  tax_percent: number;
  discount_percent: number;
  stock: number;
  reorder_point: number;
  hsn_code: string | null;
  status: 'active' | 'draft' | 'discontinued';
  specs: {
    dimensions: string | null;
    power: string | null;
    capacity: string | null;
    weight: string | null;
    material: string | null;
    color: string | null;
  };
  /** Absolute Cloudinary URLs, primary first, de-duplicated. */
  images: string[];
  variants: SyncVariantPayload[];
  updated_at: string;
  /**
   * SHA-256 over everything above except `updated_at`. The consumer stores it
   * and compares on the next scan, so a touched-but-unchanged row does not
   * show up as "changed".
   */
  content_hash: string;
}

/** Prisma `Decimal | number | null` → plain number. */
function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(typeof value === 'object' ? value.toString() : value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(typeof value === 'object' ? value.toString() : value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? null : trimmed;
}

/**
 * `imageUrl` + `images` collapsed into one ordered, de-duplicated list with the
 * primary first. `images` is free-form JSON on this model, so anything that is
 * not an absolute http(s) URL is dropped rather than shipped to a partner that
 * cannot resolve it.
 */
export function galleryUrls(primary: unknown, gallery: unknown): string[] {
  const candidates: unknown[] = [];
  if (typeof primary === 'string') candidates.push(primary);
  if (Array.isArray(gallery)) candidates.push(...gallery);

  const urls: string[] = [];
  for (const candidate of candidates) {
    // Tolerate both `["url", …]` and `[{ url: "…" }, …]` shapes.
    const raw =
      typeof candidate === 'string'
        ? candidate
        : candidate && typeof candidate === 'object'
          ? ((candidate as any).url ?? (candidate as any).secure_url)
          : null;
    if (typeof raw !== 'string') continue;
    const url = raw.trim();
    if (!/^https?:\/\//i.test(url) || urls.includes(url)) continue;
    urls.push(url);
  }
  return urls;
}

/**
 * The composed variant SKU. A suffix that already carries the parent SKU is
 * used untouched, so both conventions in the data produce the same result and
 * the consumer never sees "KK-1-KK-1-RED".
 */
export function composeVariantSku(parentSku: string, suffix: string | null, variantId: number): string {
  const clean = (suffix ?? '').trim();
  if (clean === '') return `${parentSku}-V${variantId}`;
  if (clean.toLowerCase().startsWith(parentSku.toLowerCase())) return clean;
  return `${parentSku}-${clean}`;
}

/** Stable JSON — keys sorted at every level, so hashing is order-independent. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      sorted[key] = canonical((value as any)[key]);
    }
    return sorted;
  }
  return value;
}

export function contentHash(payload: Omit<SyncProductPayload, 'content_hash' | 'updated_at'>): string {
  return createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
}

/** A Product row with `variants` included → the wire payload. */
export function toSyncPayload(product: any): SyncProductPayload {
  const parentPrice = num(product.price);

  const variants: SyncVariantPayload[] = (product.variants ?? []).map((variant: any) => {
    // An absolute per-variant price wins; otherwise it is the parent price
    // shifted by the modifier — the same rule the storefront applies.
    const absolute = nullableNum(variant.price);
    const price = absolute !== null ? absolute : parentPrice + num(variant.priceModifier);

    return {
      external_id: variant.id,
      sku: composeVariantSku(product.sku, variant.skuSuffix, variant.id),
      sku_suffix: text(variant.skuSuffix),
      label: text(variant.variantValue) ?? text(variant.skuSuffix) ?? `Variant ${variant.id}`,
      option_type: text(variant.variantType),
      option_value: text(variant.variantValue),
      price,
      mrp: nullableNum(variant.mrp),
      weight: text(variant.weight),
      stock: num(variant.stock),
      images: galleryUrls(variant.imageUrl, variant.images),
    };
  });

  const body = {
    external_id: product.id,
    sku: product.sku,
    product_code: text(product.productCode),
    name: product.name,
    description: text(product.description),
    category_path: [product.category, product.subcategory, product.leafCategory]
      .map((part: unknown) => text(part))
      .filter((part): part is string => part !== null),
    price: parentPrice,
    mrp: nullableNum(product.mrp),
    tax_percent: num(product.taxPercent, 18),
    discount_percent: num(product.discountPercent),
    stock: num(product.stock),
    reorder_point: num(product.reorderPoint, 5),
    hsn_code: text(product.hsnCode),
    status: product.status as SyncProductPayload['status'],
    specs: {
      dimensions: text(product.dimensions),
      power: text(product.power),
      capacity: text(product.capacity),
      weight: text(product.weight),
      material: text(product.material),
      color: text(product.color),
    },
    images: galleryUrls(product.imageUrl, product.images),
    variants,
  };

  return {
    ...body,
    updated_at: new Date(product.updatedAt).toISOString(),
    content_hash: contentHash(body),
  };
}

/** Everything the feed needs loaded off the Product row. */
export const SYNC_PRODUCT_INCLUDE = {
  variants: { orderBy: { id: 'asc' } },
} as const;
