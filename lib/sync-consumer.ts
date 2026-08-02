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
 * name would silently merge two products or split one in two.
 */

/** Full payloads are requested in batches so one call cannot time out. */
const IMPORT_BATCH_SIZE = 50;

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

    // Everything needed to classify, in two queries rather than 2N.
    const [existingLinks, ourProducts] = await Promise.all([
      prisma.syncLink.findMany({ where: { source: PARTNER_SOURCE } }),
      prisma.product.findMany({
        where: { sku: { in: seenSkus } },
        select: { id: true, sku: true },
      }),
    ]);

    const linkBySku = new Map(existingLinks.map((l) => [l.externalSku, l]));
    const ourIdBySku = new Map(ourProducts.map((p) => [p.sku, p.id]));

    let created = 0;
    let updated = 0;

    for (const entry of entries) {
      if (!entry?.sku) continue;
      const link = linkBySku.get(entry.sku);

      // Adoption: a product we already hold under this SKU becomes the link's
      // target even though it was never imported through sync.
      const adopted = link?.productId ?? ourIdBySku.get(entry.sku) ?? null;

      const data = {
        externalId: entry.external_id ?? null,
        externalName: entry.name ?? null,
        productId: adopted,
        remoteHash: entry.content_hash ?? null,
        remoteUpdatedAt: entry.updated_at ? new Date(entry.updated_at) : null,
        lastScannedAt: now,
      };

      if (link) {
        await prisma.syncLink.update({ where: { id: link.id }, data });
        updated++;
      } else {
        await prisma.syncLink.create({
          data: { source: PARTNER_SOURCE, externalSku: entry.sku, ...data },
        });
        created++;
      }
    }

    // Rows we know about that the manifest no longer lists. Left in place and
    // reported as "missing" — a partner unpublishing is not a mandate to delete
    // ours.
    const missing = existingLinks.filter((l) => !seenSkus.includes(l.externalSku)).length;

    const counts = await statusCounts();
    const message =
      `Scanned ${entries.length} listing(s) from ${PARTNER_LABEL}: ` +
      `${counts.new} not here yet, ${counts.matched} matched by SKU but never synced, ` +
      `${counts.changed} changed upstream, ${counts.in_sync} already in sync.` +
      (missing ? ` ${missing} previously seen listing(s) are no longer published.` : '') +
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

// ------------------------------------------------------------------ review

export async function review(options: {
  status?: SyncItemStatus | 'all';
  search?: string;
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

  const links = await prisma.syncLink.findMany({
    where,
    include: {
      product: {
        select: { id: true, name: true, sku: true, price: true, status: true, stock: true, imageUrl: true },
      },
    },
    orderBy: [{ externalName: 'asc' }],
  });

  const rows = links.map((link) => ({
    id: link.id,
    sku: link.externalSku,
    external_id: link.externalId,
    remote_name: link.externalName,
    status: classify(link),
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

  const filtered =
    options.status && options.status !== 'all'
      ? rows.filter((r) => r.status === options.status)
      : rows;

  return {
    items: filtered.slice(options.offset, options.offset + options.limit),
    total: filtered.length,
    counts,
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
  add('category', 'Category', product?.category, mapped.category);
  add('subcategory', 'Subcategory', product?.subcategory, mapped.subcategory);
  // Their trade figure, shown first and unflagged, so the retail price below is
  // visibly a derived number rather than something the partner sent.
  add('remote_price', 'Their trade price', null, remote.price.toFixed(2), {
    informational: true,
    note: 'What Hotelic Essentials sells at, GST excluded.',
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
  add('images', 'Images', galleryOf(product).length || null, remote.images.length);
  add('variants', 'Variants', product?.variants.length ?? null, remote.variants.length);

  return {
    sku,
    status: classify(link),
    exists_here: product !== null,
    origin: remote.origin ?? null,
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
  const stats = { created: 0, updated: 0, skipped: 0, failed: 0, examined: skus.length };
  const errors: string[] = [];

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
        const outcome = await importOne(remote, options, rule, userId);
        if (outcome === 'created') stats.created++;
        else stats.updated++;
      } catch (e: any) {
        stats.failed++;
        errors.push(`${remote.sku}: ${messageOf(e)}`);
        await noteLinkError(remote.sku, messageOf(e));
      }
    }
  }

  const message =
    `Imported from ${PARTNER_LABEL}: ${stats.created} product(s) created, ${stats.updated} updated` +
    (stats.failed ? `, ${stats.failed} failed` : '') +
    '.';

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
 * Money is re-priced for retail on the way in — 30% markup, then GST added —
 * because the partner prices for the trade. See lib/sync-pricing.ts. Both the
 * import and the review diff come through here, so what the operator previews
 * is exactly what gets written.
 */
function mapProduct(remote: RemoteProduct, rule: PricingRule) {
  return {
    name: remote.name,
    description: remote.description,
    category: remote.category_path[0] ?? null,
    subcategory: remote.category_path[1] ?? null,
    leafCategory: remote.category_path[2] ?? null,
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

async function importOne(
  remote: RemoteProduct,
  options: ImportOptions,
  rule: PricingRule,
  userId?: number | null,
): Promise<'created' | 'updated'> {
  const mapped = mapProduct(remote, rule);
  const images = (remote.images ?? [])
    .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
    .slice(0, MAX_IMAGES);

  const existing = await prisma.product.findUnique({ where: { sku: remote.sku } });

  let productId: number;
  let isNew: boolean;

  if (!existing) {
    const created = await prisma.product.create({
      data: {
        ...mapped,
        sku: remote.sku,
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
    const data: Prisma.ProductUpdateInput = {
      name: mapped.name,
      description: mapped.description,
      category: mapped.category,
      subcategory: mapped.subcategory,
      leafCategory: mapped.leafCategory,
      taxPercent: mapped.taxPercent,
      reorderPoint: mapped.reorderPoint,
      hsnCode: mapped.hsnCode,
      status: mapped.status,
      dimensions: mapped.dimensions,
      power: mapped.power,
      capacity: mapped.capacity,
      weight: mapped.weight,
      material: mapped.material,
      color: mapped.color,
    };

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

  return isNew ? 'created' : 'updated';
}

/**
 * Variants are matched on their suffix within the parent, which is how they are
 * keyed here — the partner's globally unique SKU is decomposed on the way in.
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

    const match = existing.find(
      (v) => (v.skuSuffix ?? '').toLowerCase() === suffix.toLowerCase(),
    );

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

    const data: Prisma.ProductVariantUpdateInput = { ...base };
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

function messageOf(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Unexpected error.';
}
