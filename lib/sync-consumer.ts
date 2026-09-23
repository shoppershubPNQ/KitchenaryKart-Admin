import { Prisma, ProductStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { PARTNER_LABEL, PARTNER_SOURCE, partnerGet } from '@/lib/sync-connection';
import {
  applyPricingRule,
  effectiveGstPercent,
  getPricingRule,
  pricingNote,
  type PricingRule,
} from '@/lib/sync-pricing';

/**
 * Catalogue sync — the INBOUND half, importing what Hotelic Essentials
 * publishes. The mirror of app/api/sync/*, which publishes what we hold.
 *
 * Two steps on purpose, so nothing changes without review:
 *
 *   scan()    pulls the partner's cheap manifest and works out, per SKU, what
 *             state it is in here. Writes only to sync_links — never a product.
 *   runImport() pulls full payloads for an explicit set of SKUs and writes
 *             them. The ONLY function here that touches the catalogue.
 *
 * SKU is the identity throughout. Names are never used to match: the same item
 * is routinely called different things in the two systems, and matching on a
 * name would silently merge two products or split one in two. The partner's
 * own id is kept beside the SKU for exactly one purpose: when a SKU is renamed
 * upstream, the id is how the listing is recognised as the same one, so the
 * rename lands on our product instead of creating a twin and orphaning it.
 */

/** Full payloads are requested in batches so one call cannot time out. */
const IMPORT_BATCH_SIZE = 50;

/** Scan writes sent at once — enough to be fast, few enough not to drain the pool. */
const SCAN_WRITE_CHUNK = 25;

/** Per-product image ceiling — a runaway gallery is a data error. */
const MAX_IMAGES = 12;

/** Row-level failures kept on the run record. */
const MAX_STORED_ERRORS = 50;

export type SyncItemStatus = 'new' | 'matched' | 'changed' | 'in_sync' | 'ignored' | 'missing';

// --------------------------------------------------------------- wire types

export interface RemoteVariant {
  external_id: number;
  sku: string;
  sku_suffix: string | null;
  label: string;
  option_type: string | null;
  option_value: string | null;
  price: number;
  mrp: number | null;
  weight: string | null;
  stock: number;
  images: string[];
}

export interface RemoteProduct {
  external_id: number;
  sku: string;
  product_code: string | null;
  name: string;
  description: string | null;
  category_path: string[];
  price: number;
  mrp: number | null;
  /**
   * Null means the partner records no rate for this listing, which is NOT the
   * same as a zero-rated one — the price transform falls back to the default
   * for the first and honours the zero for the second.
   */
  tax_percent: number | null;
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
  images: string[];
  variants: RemoteVariant[];
  updated_at: string;
  content_hash: string;
  origin?: string | null;
}

export interface ManifestEntry {
  external_id: number;
  sku: string;
  name: string;
  status: string;
  price: number;
  mrp: number | null;
  stock: number;
  category_path: string[];
  image: string | null;
  image_count: number;
  variant_count: number;
  content_hash: string;
  updated_at: string;
  origin?: string | null;
}

export interface ImportOptions {
  skus?: string[];
  all?: boolean;
  onlyNew?: boolean;
  /** Apply to UPDATES only — a create always takes every field. */
  updatePrice?: boolean;
  updateStock?: boolean;
  updateImages?: boolean;
  /** Name, description, HSN, GST rate, reorder point, specs; a variant's type, value and weight. */
  updateDetails?: boolean;
  /** Published / draft / discontinued. */
  updateStatus?: boolean;
  /**
   * Where a NEWLY created product is shelved here. Left unset, the partner's
   * own top-level shelf is matched to ours by name; set, it wins for every
   * product in this run. Never touches a product that already exists — our
   * shelving stays ours.
   */
  category?: string;
  subcategory?: string;
}

// ---------------------------------------------------------------- classify

/**
 * The single definition of what state a listing is in. Every count, filter and
 * bulk selection runs through this, so the tab badges and what "Import all"
 * actually does can never disagree.
 */
export function classify(link: {
  productId: number | null;
  remoteHash: string | null;
  importedHash: string | null;
  ignoredAt: Date | null;
}): SyncItemStatus {
  if (link.ignoredAt) return 'ignored';
  // Seen in an earlier scan but absent from the latest one.
  if (!link.remoteHash) return 'missing';
  if (!link.productId) return 'new';
  // Linked to one of ours but never imported through sync — it was entered
  // here independently, so there are differences worth reviewing.
  if (!link.importedHash) return 'matched';
  return link.importedHash === link.remoteHash ? 'in_sync' : 'changed';
}

function emptyCounts(): Record<SyncItemStatus, number> {
  return { new: 0, matched: 0, changed: 0, in_sync: 0, ignored: 0, missing: 0 };
}

export async function statusCounts(): Promise<Record<SyncItemStatus, number>> {
  const links = await prisma.syncLink.findMany({
    where: { source: PARTNER_SOURCE },
    select: { productId: true, remoteHash: true, importedHash: true, ignoredAt: true },
  });
  const counts = emptyCounts();
  for (const link of links) counts[classify(link)]++;
  return counts;
}

// -------------------------------------------------------------------- scan

/**
 * Pulls the partner manifest and reconciles it against sync_links.
 *
 * The important step is the adoption pass: much of the partner catalogue
 * already exists here under the same SKU, so a remote SKU with no link is
 * looked up among our own products BEFORE being called "new". Without it a
 * first bulk import would try to create duplicates and die on the unique SKU
 * index.
 */
export async function scan(userId?: number | null) {
  const run = await prisma.syncRun.create({
    data: { source: PARTNER_SOURCE, mode: 'scan', userId: userId ?? null },
  });

  try {
    const body = await partnerGet<{
      products: ManifestEntry[];
      total: number;
      truncated?: boolean;
    }>('/manifest');

    const entries = Array.isArray(body?.products) ? body.products : [];
    const now = new Date();
    const seenSkus = entries.map((e) => e.sku).filter((s) => typeof s === 'string');
    const seen = new Set(seenSkus);

    // Everything needed to classify, in two queries rather than 2N.
    const [existingLinks, ourProducts] = await Promise.all([
      prisma.syncLink.findMany({ where: { source: PARTNER_SOURCE } }),
      prisma.product.findMany({
        where: { sku: { in: seenSkus } },
        select: { id: true, sku: true },
      }),
    ]);

    const linkBySku = new Map(existingLinks.map((l) => [l.externalSku, l]));
    const linkByExternalId = new Map(
      existingLinks.filter((l) => l.externalId !== null).map((l) => [l.externalId as number, l]),
    );
    const ourIdBySku = new Map(ourProducts.map((p) => [p.sku, p.id]));

    /*
     * A link may still name a product that has since been deleted here.
     * Trusting the stored id would keep reporting the listing as imported and
     * in sync long after the product stopped existing, so it is re-checked
     * against the catalogue as it is now.
     */
    const linkedIds = existingLinks
      .map((l) => l.productId)
      .filter((id): id is number => id !== null);
    const liveProducts = linkedIds.length
      ? await prisma.product.findMany({ where: { id: { in: linkedIds } }, select: { id: true } })
      : [];
    const live = new Set(liveProducts.map((p) => p.id));

    let created = 0;
    let updated = 0;
    const renames: string[] = [];
    const touched = new Set<number>();
    /**
     * Prisma's promises are lazy — nothing is sent until one is awaited — so
     * the loop can decide every row first and the writes go out in chunks
     * afterwards. See the chunked await below.
     */
    const writes: Prisma.PrismaPromise<unknown>[] = [];

    for (const entry of entries) {
      if (!entry?.sku) continue;
      const bySku = linkBySku.get(entry.sku);

      // A SKU nobody here has heard of may still be a listing we know — under
      // the SKU it used to have. The partner's id says so, provided the old
      // SKU is genuinely gone from the manifest: if it is still published,
      // these are two listings and the new one is simply new.
      const byId =
        !bySku && entry.external_id != null ? linkByExternalId.get(entry.external_id) : undefined;
      const renamedFrom =
        byId && byId.externalSku !== entry.sku && !seen.has(byId.externalSku)
          ? byId.externalSku
          : null;
      const link = bySku ?? (renamedFrom ? byId : undefined);

      // Adoption: a product we already hold under this SKU becomes the link's
      // target even though it was never imported through sync.
      const stored = link?.productId != null && live.has(link.productId) ? link.productId : null;
      const adopted = stored ?? ourIdBySku.get(entry.sku) ?? null;

      const data = {
        externalId: entry.external_id ?? null,
        externalName: entry.name ?? null,
        productId: adopted,
        remoteHash: entry.content_hash ?? null,
        remoteUpdatedAt: entry.updated_at ? new Date(entry.updated_at) : null,
        lastScannedAt: now,
        // What the operator needs to judge a listing without opening it.
        // Display only — the import re-reads the full payload.
        remotePrice: numberOrNull(entry.price),
        remoteMrp: numberOrNull(entry.mrp),
        remoteStock: Number.isFinite(entry.stock) ? entry.stock : null,
        remoteStatus: entry.status ?? null,
        remoteImage: entry.image ?? null,
        remoteImageCount: Number.isFinite(entry.image_count) ? entry.image_count : null,
        remoteVariantCount: Number.isFinite(entry.variant_count) ? entry.variant_count : null,
        remoteCategoryPath: Array.isArray(entry.category_path)
          ? entry.category_path.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
          : [],
        // The product it pointed at is gone, so it is not 'already imported'.
        ...(adopted === null ? { importedHash: null, importedAt: null } : {}),
      };

      if (link) {
        writes.push(
          prisma.syncLink.update({
            where: { id: link.id },
            // The link follows the rename now; the product's own SKU changes
            // on import, once the operator has seen it in the queue.
            data: renamedFrom ? { ...data, externalSku: entry.sku } : data,
          }),
        );
        touched.add(link.id);
        if (renamedFrom) renames.push(`${renamedFrom} → ${entry.sku}`);
        updated++;
      } else {
        writes.push(
          prisma.syncLink.create({
            data: { source: PARTNER_SOURCE, externalSku: entry.sku, ...data },
          }),
        );
        created++;
      }
    }

    /*
     * One round trip per listing, awaited in turn, is ~1.5s each from a laptop
     * — half an hour for this catalogue, and uncomfortably close to the
     * function limit even from the same region. The rows are independent, so
     * they go out in chunks instead; the chunk is small enough not to exhaust
     * the connection pool.
     */
    for (let i = 0; i < writes.length; i += SCAN_WRITE_CHUNK) {
      await Promise.all(writes.slice(i, i + SCAN_WRITE_CHUNK));
    }

    // Rows we know about that the manifest no longer lists. Left in place and
    // reported as "missing" — a partner unpublishing is not a mandate to delete
    // ours. A renamed link was seen, under its new SKU.
    const missing = existingLinks.filter((l) => !touched.has(l.id)).length;

    const counts = await statusCounts();
    const message =
      `Scanned ${entries.length} listing(s) from ${PARTNER_LABEL}: ` +
      `${counts.new} not here yet, ${counts.matched} matched by SKU but never synced, ` +
      `${counts.changed} changed upstream, ${counts.in_sync} already in sync.` +
      (missing ? ` ${missing} previously seen listing(s) are no longer published.` : '') +
      (renames.length
        ? ` ${renames.length} SKU(s) renamed upstream (${renames.slice(0, 5).join(', ')}${
            renames.length > 5 ? ', …' : ''
          }) — import them to rename here too.`
        : '') +
      (body?.truncated ? ' The partner catalogue was truncated — not every listing was returned.' : '');

    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        examined: entries.length,
        created,
        updated,
        skipped: counts.in_sync,
        finishedAt: new Date(),
        message,
      },
    });

    return { counts, pending: counts.new + counts.matched + counts.changed, examined: entries.length, missing, message };
  } catch (e: any) {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { failed: 1, finishedAt: new Date(), message: messageOf(e) },
    });
    throw e;
  }
}

// --------------------------------------------------------- partner pricing

export interface PartnerPrice {
  /** The partner's SKU this came from — not always ours; see below. */
  sku: string;
  /**
   * What the partner charges the trade, in rupees, GST INCLUDED — that is how
   * Hotelic Essentials publishes every price, and the whole import is built on
   * it (see lib/sync-pricing.ts: adding GST on top would charge it twice).
   */
  price: number | null;
  /** The same figure with GST backed out, at the product's own rate. */
  price_ex_gst: number | null;
  /** That price after our markup and GST rule: what we would list it at. */
  landed_price: number | null;
  stock: number | null;
  /** True when ours is more than a rupee away from the landed figure. */
  drifted: boolean;
  scanned_at: Date | null;
}

/**
 * What Hotelic Essentials charges for each of these products, from the last
 * scan's snapshot — no request to them, so this cannot slow a page down or
 * empty it when they are offline.
 *
 * A product is matched to their listing by SKU, and also by SKU + "-P":
 * they have been re-issuing SKUs with that suffix, and on 23 Sep 2026 that
 * accounted for 334 of the 434 listings this side had never seen. Without the
 * second form, two thirds of the catalogue would show no partner price at all.
 * An exact match always wins over the suffixed one.
 */
export async function partnerPricesFor(
  skus: string[],
  /** GST rate per SKU, for backing the tax out. Missing rates fall to 18%. */
  gstBySku?: Map<string, number>,
): Promise<Map<string, PartnerPrice>> {
  const wanted = skus.filter(Boolean);
  if (wanted.length === 0) return new Map();

  const candidates = [...new Set(wanted.flatMap((s) => [s, `${s}-P`]))];
  const [links, rule] = await Promise.all([
    prisma.syncLink.findMany({
      where: { source: PARTNER_SOURCE, externalSku: { in: candidates } },
      select: { externalSku: true, remotePrice: true, remoteStock: true, lastScannedAt: true },
    }),
    getPricingRule(),
  ]);

  const bySku = new Map(links.map((l) => [l.externalSku, l]));
  const out = new Map<string, PartnerPrice>();

  for (const sku of wanted) {
    /*
     * The exact SKU wins, but only if it still carries a price. When a
     * listing is re-issued as "SKU-P" the old link stays behind with a null
     * price — it was not in the manifest the last scan read — so preferring
     * the exact match blindly reports "they don't publish this" for a product
     * they very much do. Whichever link has a price is the live one.
     */
    const exact = bySku.get(sku);
    const suffixed = bySku.get(`${sku}-P`);
    const link =
      exact && exact.remotePrice !== null ? exact : (suffixed ?? exact);
    if (!link || link.remotePrice === null) continue;
    const price = Number(link.remotePrice);
    const rate = effectiveGstPercent(gstBySku?.get(sku));
    out.set(sku, {
      sku: link.externalSku,
      price,
      price_ex_gst: Math.round((price / (1 + rate / 100)) * 100) / 100,
      landed_price: applyPricingRule(price, null, rule),
      stock: link.remoteStock,
      drifted: false, // filled in by the caller, which knows our price
      scanned_at: link.lastScannedAt,
    });
  }
  return out;
}

// ------------------------------------------------------------------ review

export async function review(options: {
  status?: SyncItemStatus | 'all';
  search?: string;
  category?: string;
  limit: number;
  offset: number;
}) {
  const where: Prisma.SyncLinkWhereInput = { source: PARTNER_SOURCE };
  const search = (options.search ?? '').trim();
  if (search !== '') {
    where.OR = [
      { externalSku: { contains: search, mode: 'insensitive' } },
      { externalName: { contains: search, mode: 'insensitive' } },
    ];
  }
  // The partner's own top-level shelf is filtered in memory, not here: the
  // facet counts below have to describe every shelf, including the ones not
  // currently selected, or the filter could not be changed.
  const category = (options.category ?? '').trim();

  const links = await prisma.syncLink.findMany({
    where,
    include: {
      product: {
        select: { id: true, name: true, sku: true, price: true, status: true, stock: true, imageUrl: true },
      },
    },
    orderBy: [{ externalName: 'asc' }],
  });

  // Shown beside each incoming price so the operator sees what it becomes
  // here, not what the partner charges the trade.
  const rule = await getPricingRule();

  const rows = links.map((link) => ({
    id: link.id,
    sku: link.externalSku,
    external_id: link.externalId,
    remote_name: link.externalName,
    status: classify(link),
    remote: {
      price: link.remotePrice === null ? null : Number(link.remotePrice),
      mrp: link.remoteMrp === null ? null : Number(link.remoteMrp),
      /**
       * Their price after our markup and GST rule — what we would charge.
       * Exact under the default rule ('none', which touches no tax). Under
       * 'add'/'remove' it is an estimate at the default rate, because the
       * manifest carries no per-listing rate; the import uses the real one
       * from the full payload, and Compare shows it.
       */
      landed_price:
        link.remotePrice === null
          ? null
          : applyPricingRule(Number(link.remotePrice), null, rule),
      stock: link.remoteStock,
      status: link.remoteStatus,
      image: link.remoteImage,
      image_count: link.remoteImageCount,
      variant_count: link.remoteVariantCount,
      category_path: link.remoteCategoryPath,
    },
    product: link.product
      ? {
          id: link.product.id,
          name: link.product.name,
          price: Number(link.product.price),
          status: link.product.status,
          stock: link.product.stock,
          image: link.product.imageUrl,
        }
      : null,
    remote_updated_at: link.remoteUpdatedAt,
    imported_at: link.importedAt,
    ignored: link.ignoredAt !== null,
    last_error: link.lastError,
  }));

  const counts = emptyCounts();
  for (const row of rows) counts[row.status]++;

  const inTab =
    options.status && options.status !== 'all'
      ? rows.filter((r) => r.status === options.status)
      : rows;
  const filtered = category === '' ? inTab : inTab.filter((r) => r.remote.category_path.includes(category));

  // The partner's top-level shelves, with how many listings sit on each in
  // the CURRENT status tab — so the filter reflects what is actually there.
  const facets = new Map<string, number>();
  for (const row of inTab) {
    const top = row.remote.category_path[0];
    if (top) facets.set(top, (facets.get(top) ?? 0) + 1);
  }

  return {
    items: filtered.slice(options.offset, options.offset + options.limit),
    total: filtered.length,
    counts,
    categories: [...facets].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    source: PARTNER_SOURCE,
    source_label: PARTNER_LABEL,
  };
}

// -------------------------------------------------------------------- diff

/** Field-by-field comparison for one SKU, pulled live from the partner. */
export async function diff(sku: string) {
  const link = await prisma.syncLink.findUnique({
    where: { sync_link_source_sku: { source: PARTNER_SOURCE, externalSku: sku } },
  });
  if (!link) throw new Error(`"${sku}" is not in the sync list — run a scan first.`);

  const remote = await fetchOne(sku);
  if (!remote) throw new Error(`${PARTNER_LABEL} no longer publishes "${sku}".`);

  const product = link.productId
    ? await prisma.product.findUnique({
        where: { id: link.productId },
        include: { variants: true },
      })
    : null;

  const rule = await getPricingRule();
  const mapped = mapProduct(remote, rule);
  const derived = remote.variants.length > 0 || (product?.variants.length ?? 0) > 0;

  const fields: {
    field: string;
    label: string;
    ours: string | null;
    theirs: string | null;
    differs: boolean;
    note?: string;
  }[] = [];

  const add = (
    field: string,
    label: string,
    ours: unknown,
    theirs: unknown,
    opts?: { note?: string; informational?: boolean },
  ) => {
    const left = display(ours);
    const right = display(theirs);
    fields.push({
      field,
      label,
      ours: left,
      theirs: right,
      differs: opts?.informational ? false : left !== right,
      ...(opts?.note ? { note: opts.note } : {}),
    });
  };

  add('name', 'Name', product?.name, mapped.name);
  add('description', 'Description', product?.description, mapped.description);
  add('category', 'Category', product?.category, remote.category_path[0] ?? null, {
    informational: true,
    note: 'Each site keeps its own categories — sync never changes this.',
  });
  add('subcategory', 'Subcategory', product?.subcategory, remote.category_path[1] ?? null, {
    informational: true,
    note: 'Each site keeps its own categories — sync never changes this.',
  });
  // Their trade figure, shown first and unflagged, so the retail price below is
  // visibly a derived number rather than something the partner sent.
  add('remote_price', 'Their trade price', null, remote.price.toFixed(2), {
    informational: true,
    note: 'What Hotelic Essentials sells at, GST included.',
  });
  add(
    'price',
    derived ? 'Price (set by variants)' : 'Price',
    product ? Number(product.price) : null,
    mapped.price,
    derived
      ? { informational: true, note: 'Taken from the variants, not this figure.' }
      : { note: pricingNote(remote.tax_percent, rule) },
  );
  add('mrp', 'MRP', product?.mrp != null ? Number(product.mrp) : null, mapped.mrp, {
    note: pricingNote(remote.tax_percent, rule),
  });
  add('taxPercent', 'GST rate', product ? Number(product.taxPercent) : null, mapped.taxPercent);
  add('stock', 'Stock', product?.stock, mapped.stock);
  add('reorderPoint', 'Reorder point', product?.reorderPoint, mapped.reorderPoint);
  add('status', 'Status', product?.status, mapped.status);
  add('hsnCode', 'HSN code', product?.hsnCode, mapped.hsnCode);
  add('weight', 'Weight', product?.weight, mapped.weight);
  add('dimensions', 'Dimensions', product?.dimensions, mapped.dimensions);
  add('power', 'Power', product?.power, mapped.power);
  add('color', 'Colour', product?.color, mapped.color);
  add('capacity', 'Capacity', product?.capacity, mapped.capacity);
  add('material', 'Material', product?.material, mapped.material);
  // Counts alone hide a replaced picture; the URLs are compared as an ordered
  // list, and both galleries travel so the Compare modal can show them.
  const hereImages = galleryOf(product);
  add('images', 'Images', hereImages.length || null, remote.images.length);
  fields[fields.length - 1].differs =
    product !== null && hereImages.join('\n') !== remote.images.join('\n');
  add('variants', 'Variants', product?.variants.length ?? null, remote.variants.length);

  return {
    sku,
    status: classify(link),
    exists_here: product !== null,
    origin: remote.origin ?? null,
    images_here: hereImages,
    remote: {
      name: remote.name,
      category_path: remote.category_path,
      price: remote.price,
      mrp: remote.mrp,
      stock: remote.stock,
      status: remote.status,
      images: remote.images,
      variants: remote.variants.map((v) => ({
        sku: v.sku,
        label: v.label,
        price: v.price,
        stock: v.stock,
        images: v.images.length,
      })),
      updated_at: remote.updated_at,
    },
    product: product ? { id: product.id, name: product.name, sku: product.sku } : null,
    fields,
    changed_fields: fields.filter((f) => f.differs).length,
  };
}

// ------------------------------------------------------------------ import

export async function runImport(options: ImportOptions, userId?: number | null) {
  const skus = await resolveSkus(options);
  if (skus.length === 0) {
    throw new Error('Nothing to import — select at least one listing.');
  }

  const run = await prisma.syncRun.create({
    data: { source: PARTNER_SOURCE, mode: 'import', userId: userId ?? null, examined: skus.length },
  });

  const rule = await getPricingRule();
  // Built once per run: it reads our whole category table, and every create
  // consults it.
  const resolveCategory = await categoryResolver();
  const stats = { created: 0, updated: 0, renamed: 0, skipped: 0, failed: 0, examined: skus.length };
  const errors: string[] = [];
  const renames: string[] = [];
  /** Created products that matched no shelf here — reported, not hidden. */
  const unfiled: string[] = [];

  for (let i = 0; i < skus.length; i += IMPORT_BATCH_SIZE) {
    const batch = skus.slice(i, i + IMPORT_BATCH_SIZE);

    let products: RemoteProduct[];
    try {
      const body = await partnerGet<{ products: RemoteProduct[] }>('/products', {
        sku: batch.join(','),
        limit: IMPORT_BATCH_SIZE,
      });
      products = body?.products ?? [];
    } catch (e: any) {
      // A whole batch failing is a connection problem, not a data problem.
      stats.failed += batch.length;
      errors.push(`${batch.length} listing(s) could not be fetched: ${messageOf(e)}`);
      continue;
    }

    const returned = new Set(products.map((p) => p.sku));
    for (const sku of batch) {
      if (!returned.has(sku)) {
        stats.failed++;
        errors.push(`${sku}: ${PARTNER_LABEL} no longer publishes this listing.`);
        await noteLinkError(sku, 'No longer published by the partner.');
      }
    }

    for (const remote of products) {
      try {
        const { outcome, renamedFrom, filedUnder } = await importOne(
          remote,
          options,
          rule,
          resolveCategory,
          userId,
        );
        if (outcome === 'created' && filedUnder === null) unfiled.push(remote.sku);
        if (outcome === 'created') stats.created++;
        else stats.updated++;
        if (renamedFrom) {
          stats.renamed++;
          renames.push(`${renamedFrom} → ${remote.sku}`);
        }
      } catch (e: any) {
        stats.failed++;
        errors.push(`${remote.sku}: ${messageOf(e)}`);
        await noteLinkError(remote.sku, messageOf(e));
      }
    }
  }

  const message =
    `Imported from ${PARTNER_LABEL}: ${stats.created} product(s) created, ${stats.updated} updated` +
    (stats.renamed
      ? `, ${stats.renamed} SKU(s) renamed (${renames.slice(0, 5).join(', ')}${
          renames.length > 5 ? ', …' : ''
        })`
      : '') +
    (stats.failed ? `, ${stats.failed} failed` : '') +
    '.' +
    // An unfiled product is live but reachable only by search, so say so
    // rather than letting it sit invisible on every category page.
    (unfiled.length
      ? ` ${unfiled.length} new product(s) matched no category here and are unfiled` +
        ` (${unfiled.slice(0, 5).join(', ')}${unfiled.length > 5 ? ', …' : ''})` +
        ' — give them a category or they will not appear on any category page.'
      : '');

  await prisma.syncRun.update({
    where: { id: run.id },
    data: {
      created: stats.created,
      updated: stats.updated,
      skipped: stats.skipped,
      failed: stats.failed,
      finishedAt: new Date(),
      message,
      errors: errors.length ? (errors.slice(0, MAX_STORED_ERRORS) as any) : undefined,
    },
  });

  return {
    ...stats,
    message,
    errors: errors.slice(0, 10),
    error_count: errors.length,
    counts: await statusCounts(),
  };
}

/** `all` expands to every pending row; otherwise the explicit selection. */
async function resolveSkus(options: ImportOptions): Promise<string[]> {
  if (options.skus?.length) return [...new Set(options.skus)];
  if (!options.all) return [];

  const links = await prisma.syncLink.findMany({
    where: { source: PARTNER_SOURCE, ignoredAt: null },
    select: {
      externalSku: true,
      productId: true,
      remoteHash: true,
      importedHash: true,
      ignoredAt: true,
    },
  });

  // "Import everything" means everything still needing work. Rows already in
  // sync are left alone, so a bulk run is idempotent and cheap.
  const wanted: SyncItemStatus[] = options.onlyNew ? ['new'] : ['new', 'matched', 'changed'];

  return links.filter((l) => wanted.includes(classify(l))).map((l) => l.externalSku);
}

/**
 * The wire payload translated to our columns.
 *
 * Money is re-priced for retail on the way in — the markup and GST rule in
 * lib/sync-pricing.ts — because the partner prices for the trade. Both the
 * import and the review diff come through here, so what the operator previews
 * is exactly what gets written.
 */
function mapProduct(remote: RemoteProduct, rule: PricingRule) {
  return {
    name: remote.name,
    description: remote.description,
    // No category/subcategory/leafCategory: the two catalogues are shelved
    // differently on purpose. A new import lands unfiled for the operator to
    // place; an update leaves our shelving exactly where it is.
    price: applyPricingRule(remote.price, remote.tax_percent, rule),
    mrp: remote.mrp != null ? applyPricingRule(remote.mrp, remote.tax_percent, rule) : null,
    taxPercent: effectiveGstPercent(remote.tax_percent),
    discountPercent: Number.isFinite(remote.discount_percent) ? remote.discount_percent : 0,
    stock: remote.stock,
    reorderPoint: Number.isFinite(remote.reorder_point) ? remote.reorder_point : 5,
    hsnCode: remote.hsn_code,
    status: remote.status as ProductStatus,
    dimensions: remote.specs?.dimensions ?? null,
    power: remote.specs?.power ?? null,
    capacity: remote.specs?.capacity ?? null,
    weight: remote.specs?.weight ?? null,
    material: remote.specs?.material ?? null,
    color: remote.specs?.color ?? null,
  };
}

/** `PID-00054` — the human identifier every product here carries. */
function makeProductCode(id: number): string {
  return `PID-${String(id).padStart(5, '0')}`;
}

/**
 * The link for a listing: by its SKU, else — when the SKU was renamed
 * upstream — by the partner's id, so the rename lands on the product we
 * already hold rather than creating a twin of it.
 */
async function findLink(remote: RemoteProduct) {
  const bySku = await prisma.syncLink.findUnique({
    where: { sync_link_source_sku: { source: PARTNER_SOURCE, externalSku: remote.sku } },
  });
  if (bySku) return bySku;
  if (remote.external_id == null) return null;
  return prisma.syncLink.findFirst({
    where: { source: PARTNER_SOURCE, externalId: remote.external_id, productId: { not: null } },
    orderBy: { updatedAt: 'desc' },
  });
}

async function importOne(
  remote: RemoteProduct,
  options: ImportOptions,
  rule: PricingRule,
  resolveCategory: (path: string[]) => { category: string | null; subcategory: string | null },
  userId?: number | null,
): Promise<{ outcome: 'created' | 'updated'; renamedFrom: string | null; filedUnder: string | null }> {
  const mapped = mapProduct(remote, rule);
  const images = (remote.images ?? [])
    .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
    .slice(0, MAX_IMAGES);

  // Ours, found through the link first — that is what survives a rename —
  // and by SKU only when no link points at a live product.
  const link = await findLink(remote);
  const linked = link?.productId
    ? await prisma.product.findUnique({ where: { id: link.productId } })
    : null;
  const existing = linked ?? (await prisma.product.findUnique({ where: { sku: remote.sku } }));

  let productId: number;
  let isNew: boolean;
  let renamedFrom: string | null = null;

  // Only a create is filed. An update leaves our shelving exactly where it is,
  // which is the whole reason mapProduct() omits these columns.
  const filed = existing
    ? { category: null, subcategory: null }
    : options.category
      ? { category: options.category, subcategory: options.subcategory ?? null }
      : resolveCategory(remote.category_path ?? []);

  if (!existing) {
    const created = await prisma.product.create({
      data: {
        ...mapped,
        sku: remote.sku,
        category: filed.category,
        subcategory: filed.subcategory,
        imageUrl: images[0] ?? null,
        images: images.length ? (images as any) : undefined,
        createdById: userId ?? null,
      },
    });
    // The code is derived from the primary key, so it is stamped after insert.
    await prisma.product.update({
      where: { id: created.id },
      data: { productCode: makeProductCode(created.id) },
    });
    productId = created.id;
    isNew = true;
  } else {
    const data: Prisma.ProductUpdateInput = {};

    // The SKU is the listing's identity and follows the partner whatever else
    // is held back — a label on a shelf here must read what the invoice from
    // there reads. Refused, not forced, when the new SKU is already somebody
    // else's here.
    if (existing.sku !== remote.sku) {
      const clash = await prisma.product.findUnique({
        where: { sku: remote.sku },
        select: { id: true, name: true },
      });
      if (clash && clash.id !== existing.id) {
        throw new Error(
          `SKU "${remote.sku}" already belongs to "${clash.name}" here — rename or merge that product first.`,
        );
      }
      data.sku = remote.sku;
      renamedFrom = existing.sku;
    }

    if (options.updateDetails !== false) {
      data.name = mapped.name;
      data.description = mapped.description;
      data.taxPercent = mapped.taxPercent;
      data.reorderPoint = mapped.reorderPoint;
      data.hsnCode = mapped.hsnCode;
      data.dimensions = mapped.dimensions;
      data.power = mapped.power;
      data.capacity = mapped.capacity;
      data.weight = mapped.weight;
      data.material = mapped.material;
      data.color = mapped.color;
    }
    if (options.updateStatus !== false) data.status = mapped.status;

    if (options.updatePrice !== false) {
      data.price = mapped.price;
      data.mrp = mapped.mrp;
      data.discountPercent = mapped.discountPercent;
    }
    if (options.updateStock !== false && remote.variants.length === 0) {
      data.stock = mapped.stock;
    }
    if (options.updateImages !== false && images.length) {
      data.imageUrl = images[0];
      data.images = images as any;
    }

    await prisma.product.update({ where: { id: existing.id }, data });
    productId = existing.id;
    isNew = false;

    // Stock moved by a sync is still a stock movement — record it so the
    // inventory history does not show an unexplained jump.
    if (options.updateStock !== false && remote.variants.length === 0) {
      const delta = mapped.stock - existing.stock;
      if (delta !== 0) {
        await prisma.inventoryMovement.create({
          data: {
            productId: existing.id,
            movementType: 'adjustment',
            quantity: delta,
            notes: `${PARTNER_LABEL} sync (set to ${mapped.stock})`,
            createdById: userId ?? null,
          },
        });
      }
    }
  }

  await syncVariants(productId, remote, options, rule);

  // A link still filed under the old SKU moves to the new one — or gives way
  // to the link a scan has already created under it.
  if (link && link.externalSku !== remote.sku) {
    const successor = await prisma.syncLink.findUnique({
      where: { sync_link_source_sku: { source: PARTNER_SOURCE, externalSku: remote.sku } },
      select: { id: true },
    });
    if (successor) await prisma.syncLink.delete({ where: { id: link.id } });
    else await prisma.syncLink.update({ where: { id: link.id }, data: { externalSku: remote.sku } });
  }

  await prisma.syncLink.upsert({
    where: { sync_link_source_sku: { source: PARTNER_SOURCE, externalSku: remote.sku } },
    create: {
      source: PARTNER_SOURCE,
      externalSku: remote.sku,
      externalId: remote.external_id,
      externalName: remote.name,
      productId,
      remoteHash: remote.content_hash,
      importedHash: remote.content_hash,
      remoteUpdatedAt: new Date(remote.updated_at),
      importedAt: new Date(),
      lastScannedAt: new Date(),
    },
    update: {
      externalId: remote.external_id,
      externalName: remote.name,
      productId,
      remoteHash: remote.content_hash,
      importedHash: remote.content_hash,
      remoteUpdatedAt: new Date(remote.updated_at),
      importedAt: new Date(),
      lastError: null,
    },
  });

  return { outcome: isNew ? 'created' : 'updated', renamedFrom, filedUnder: filed.category };
}

/**
 * Variants are matched on the partner's id when one has been stamped, else on
 * their suffix within the parent, which is how they are keyed here — the
 * partner's globally unique SKU is decomposed on the way in. The id is what
 * lets a child SKU renamed upstream update the row it always was.
 */
async function syncVariants(
  productId: number,
  remote: RemoteProduct,
  options: ImportOptions,
  rule: PricingRule,
): Promise<void> {
  if (!remote.variants?.length) return;

  const existing = await prisma.productVariant.findMany({ where: { productId } });

  // GST is a property of the goods, not the size or colour, so every variant
  // is re-priced at the parent's rate.
  const rate = remote.tax_percent;

  for (const rv of remote.variants) {
    const suffix = (rv.sku_suffix ?? rv.sku ?? '').trim() || null;
    if (!suffix) continue;

    const images = (rv.images ?? [])
      .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
      .slice(0, MAX_IMAGES);

    const match =
      (rv.external_id != null ? existing.find((v) => v.externalId === rv.external_id) : undefined) ??
      existing.find((v) => (v.skuSuffix ?? '').toLowerCase() === suffix.toLowerCase());

    const base = {
      variantType: rv.option_type,
      variantValue: rv.option_value ?? rv.label,
      skuSuffix: suffix,
      weight: rv.weight,
    };

    if (!match) {
      await prisma.productVariant.create({
        data: {
          ...base,
          externalId: rv.external_id ?? null,
          productId,
          price: applyPricingRule(rv.price, rate, rule),
          mrp: rv.mrp != null ? applyPricingRule(rv.mrp, rate, rule) : null,
          stock: rv.stock,
          imageUrl: images[0] ?? null,
          images: images.length ? (images as any) : undefined,
        },
      });
      continue;
    }

    const data: Prisma.ProductVariantUpdateInput = {
      externalId: rv.external_id ?? match.externalId ?? null,
    };
    // The child SKU is identity, like the parent's: it follows the partner
    // even when details are held back.
    if ((match.skuSuffix ?? '') !== suffix) data.skuSuffix = suffix;
    if (options.updateDetails !== false) {
      data.variantType = base.variantType;
      data.variantValue = base.variantValue;
      data.weight = base.weight;
    }
    if (options.updatePrice !== false) {
      data.price = applyPricingRule(rv.price, rate, rule);
      data.mrp = rv.mrp != null ? applyPricingRule(rv.mrp, rate, rule) : null;
    }
    if (options.updateStock !== false) data.stock = rv.stock;
    if (options.updateImages !== false && images.length) {
      data.imageUrl = images[0];
      data.images = images as any;
    }

    await prisma.productVariant.update({ where: { id: match.id }, data });
  }
}

// ------------------------------------------------------------ ignore + log

export async function setIgnored(sku: string, ignored: boolean) {
  const link = await prisma.syncLink.findUnique({
    where: { sync_link_source_sku: { source: PARTNER_SOURCE, externalSku: sku } },
  });
  if (!link) throw new Error(`"${sku}" is not in the sync list.`);

  await prisma.syncLink.update({
    where: { id: link.id },
    data: { ignoredAt: ignored ? new Date() : null },
  });

  return {
    sku,
    ignored,
    message: ignored
      ? `"${sku}" will stay out of the review queue until you restore it.`
      : `"${sku}" is back in the review queue.`,
  };
}

export async function history(limit = 20, offset = 0) {
  const [rows, total] = await Promise.all([
    prisma.syncRun.findMany({
      where: { source: PARTNER_SOURCE },
      include: { user: { select: { name: true } } },
      orderBy: { startedAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.syncRun.count({ where: { source: PARTNER_SOURCE } }),
  ]);

  return {
    runs: rows.map((run) => ({
      id: run.id,
      mode: run.mode,
      examined: run.examined,
      created: run.created,
      updated: run.updated,
      skipped: run.skipped,
      failed: run.failed,
      message: run.message,
      errors: Array.isArray(run.errors) ? run.errors : [],
      by: run.user?.name ?? null,
      started_at: run.startedAt,
      finished_at: run.finishedAt,
    })),
    total,
  };
}

// ----------------------------------------------------------------- helpers

async function fetchOne(sku: string): Promise<RemoteProduct | null> {
  const body = await partnerGet<{ products: RemoteProduct[] }>('/products', { sku, limit: 1 });
  return body?.products?.find((p) => p.sku === sku) ?? null;
}

async function noteLinkError(sku: string, message: string): Promise<void> {
  await prisma.syncLink
    .update({
      where: { sync_link_source_sku: { source: PARTNER_SOURCE, externalSku: sku } },
      data: { lastError: message.slice(0, 500) },
    })
    .catch(() => {
      // The link may not exist yet (import before scan) — losing the note is
      // not worth failing the import over.
    });
}

function galleryOf(product: { imageUrl: string | null; images: unknown } | null): string[] {
  if (!product) return [];
  const list = Array.isArray(product.images) ? (product.images as unknown[]) : [];
  const urls = list.filter((u): u is string => typeof u === 'string');
  if (product.imageUrl && !urls.includes(product.imageUrl)) urls.unshift(product.imageUrl);
  return urls;
}

/** Diff values compare as display strings so 18 and "18.00" do not differ. */
function display(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && 'toString' in value) return String(value);
  return String(value);
}

/**
 * Where to shelve a newly imported listing.
 *
 * The two catalogues are shelved differently on purpose, and an update never
 * moves a product we already hold. But a CREATE with no category at all lands
 * on no category page — invisible to every customer who browses rather than
 * searches — so a new product is filed on the way in.
 *
 * The partner's shelf names are ours, shortened: "Kitchen & Baking" against
 * our "Kitchen & Baking Equipment", "Polyrattan" against "Polyrattan Basket".
 * So the match is exact-then-prefix against our own category table rather than
 * a hand-kept alias list, which would rot the first time either side renames a
 * shelf. Anything that matches neither is left unfiled and reported, because
 * guessing a shelf is worse than an operator placing it.
 */
const norm = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();

async function categoryResolver() {
  const rows = await prisma.category.findMany({ select: { name: true, parentId: true, id: true } });
  const tops = rows.filter((r) => r.parentId === null);
  const childrenOf = new Map<number, string[]>();
  for (const r of rows) {
    if (r.parentId !== null) childrenOf.set(r.parentId, [...(childrenOf.get(r.parentId) ?? []), r.name]);
  }

  return function resolve(path: string[]): { category: string | null; subcategory: string | null } {
    const wantTop = (path[0] ?? '').trim();
    if (wantTop === '') return { category: null, subcategory: null };
    const n = norm(wantTop);
    const top =
      tops.find((t) => norm(t.name) === n) ?? tops.find((t) => norm(t.name).startsWith(n + ' '));
    if (!top) return { category: null, subcategory: null };

    // A subcategory is copied only when we already have that shelf under this
    // parent; inventing one would put the product in a menu entry that does
    // not exist.
    const wantSub = (path[1] ?? '').trim();
    const kids = childrenOf.get(top.id) ?? [];
    const sub =
      wantSub === ''
        ? null
        : kids.find((k) => norm(k) === norm(wantSub)) ??
          kids.find((k) => norm(k).startsWith(norm(wantSub) + ' ')) ??
          null;

    return { category: top.name, subcategory: sub };
  };
}

/** A finite, non-negative rupee figure, or null — the manifest is a partner's. */
function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function messageOf(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Unexpected error.';
}
