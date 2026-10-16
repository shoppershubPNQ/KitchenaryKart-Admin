/**
 * HE price-rise alert. Owner, 16 Oct 2026: "Jab kabhi HE prices increase kare, notification … taki koi product
 * kam sell na ho" → "Only notify me", shown as a pop-up in the admin.
 *
 * Compares every active size with Hotelic Essentials' live feed using the owner's HE rule — our price =
 * HE ex-GST × 1.30 × (1 + our GST) — and lists the sizes now priced below it.
 *
 * READ-ONLY for the catalogue: nothing here writes a price, MRP, stock or any other product field. The only
 * writes are settings rows (the snapshot and who has seen it), so the pop-up never has to call HE on a page load.
 *
 * Matching, the formula and KEEP mirror scripts/_tmp-he-family-compare.ts — change them together.
 */
import { prisma } from '@/lib/db';
import { partnerGet } from '@/lib/sync-connection';

export { HE_WATCH_ROLES } from '@/lib/he-price-watch-shared';

export const HE_WATCH_KEY = 'he_price_watch';
/** Starts with HE_WATCH_KEY on purpose: one prefix covers every row this feature owns. */
export const HE_WATCH_SEEN_PREFIX = 'he_price_watch_seen:';

const MARGIN = 1.3;
/** A jump this large is more often a feed mistake than a real rise — the owner checks with HE first. */
const BIG_PCT = 30;
/** Under ₹1 is rounding, not a rise. */
const MIN_DIFF = 1;
/** Keeps the settings row small; the biggest rises are first, so a cut drops the smallest. */
const MAX_STORED = 600;
const PAGE_SIZE = 100;
/** Safety stop if the feed ever keeps saying has_more. */
const MAX_PAGES = 200;
/** A check matching under half the sizes of the last one is a broken feed, not HE delisting half its range. */
const MIN_EXAMINED_RATIO = 0.5;

// Prices the owner fixed on purpose: never reported as a rise. Copied from scripts/_tmp-he-family-compare.ts.
export const KEEP: Record<string, string> = {
  'KKCE0011-HM750WC': 'held ₹3,068 above chain price on purpose (live customer quote)',
  'KKSP0006-BMS2': 'owner confirmed ₹1,457.30 (owner sheet)',
  'KKBT0113-FLWUG': 'owner Price List sheet ₹4,750 beats HE feed', 'KKBT0114-FLWURG': 'owner Price List sheet ₹4,750 beats HE feed',
  'KKSP0244-OS31': 'set of 2 springs', 'KKSP0236-OS32-1D2T': 'set of 2 springs', 'KKSP0009-SHBM6': 'owner raised to ₹2,301 on 13 Oct',
  ...Object.fromEntries(['KKBT0319-SSPBT2', 'KKBT0332-FLTB4', 'KKBT0363-PS15', 'KKBT0360-3LSSCK21'].map((k) => [k, 'GST re-rated 9 Oct; owner: keep price as is'])),
  ...Object.fromEntries(['KKBBA0030-H350', 'KKBBA0159-SSH12L', 'KKHRE0045-WRH', 'KKHRE0077-WMWDB1223', 'KKHRE0053-ABTR', 'KKHRE0166-SSTH'].map((k) => [k, 'GST/HSN changed 13 Oct; prices not recalculated'])),
};

export interface HeIncrease {
  sku: string;
  listingSku: string;
  productId: number;
  /** Null for a listing without sizes. */
  variantId: number | null;
  name: string;
  size: string | null;
  category: string;
  /** Our GST-inclusive selling price. */
  ours: number;
  gst: number;
  heIncl: number;
  heEx: number;
  heTax: number;
  /** HE ex-GST × 1.30 × (1 + our GST). */
  target: number;
  diff: number;
  pct: number | null;
  heUpdatedAt: string | null;
  big: boolean;
}

export interface HeWatchSnapshot {
  checkedAt: string;
  items: HeIncrease[];
  /** All rises found; more than items.length only if the list was cut to MAX_STORED. */
  total: number;
  /** Sizes skipped because HE's GST differs from ours — the rule cannot be applied to them. */
  gstDiffers: number;
  /** Sizes found in the HE feed and compared. */
  examined: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function targetPrice(heEx: number, gst: number): number {
  return r2(heEx * MARGIN * (1 + gst / 100));
}

function withPrices(row: HeIncrease, ours: number, gst: number): HeIncrease | null {
  if (row.heTax !== gst) return null;
  const target = targetPrice(row.heEx, gst);
  const diff = r2(target - ours);
  if (!(diff > MIN_DIFF)) return null;
  const pct = ours > 0 ? r2((diff / ours) * 100) : null;
  // No price at all is worth a look before anything is changed.
  return { ...row, ours, gst, target, diff, pct, big: pct === null || pct >= BIG_PCT };
}

type HeEntry = { incl: number; tax: number; upd: string };

/** The whole HE feed keyed by SKU — "-P" suffix stripped, the plain entry preferred over its "-P" twin. */
async function loadHeFeed(): Promise<Map<string, HeEntry>> {
  const feed: any[] = [];
  let complete = false;
  for (let page = 0, offset = 0; page < MAX_PAGES; page++, offset += PAGE_SIZE) {
    const r: any = await partnerGet('/products', { limit: PAGE_SIZE, offset });
    const products = Array.isArray(r?.products) ? r.products : [];
    feed.push(...products);
    if (!r?.has_more || !products.length) {
      complete = true;
      break;
    }
  }
  // A cut-short or empty feed would be saved as "no rises" over a good list. Throwing keeps the last check:
  // the cron answers 502 and the page shows the message, same as an HE outage.
  if (!complete) throw new Error(`HE feed did not finish after ${MAX_PAGES} pages — keeping the last check.`);
  const he = new Map<string, HeEntry>();
  for (const f of feed) {
    const tax = Number(f.tax_percent ?? 18);
    const list: { sku: unknown; incl: number }[] = f.variants?.length
      ? f.variants.map((v: any) => ({ sku: v.sku, incl: Number(v.price) }))
      : [{ sku: f.sku, incl: Number(f.price) }];
    for (const x of list) {
      const key = String(x.sku ?? '').replace(/-P$/i, '').toUpperCase();
      if (!he.has(key) || !/-P$/i.test(String(x.sku))) he.set(key, { incl: x.incl, tax, upd: f.updated_at ?? '' });
    }
  }
  if (he.size === 0) throw new Error('HE feed returned no products — keeping the last check.');
  return he;
}

/** Runs the whole comparison. Reads only: HE's feed and our active listings. */
export async function computeHeIncreases(): Promise<HeWatchSnapshot> {
  const he = await loadHeFeed();
  const listings = await prisma.product.findMany({
    where: { status: 'active' },
    select: {
      id: true, sku: true, name: true, taxPercent: true, price: true, category: true, subcategory: true,
      variants: { select: { id: true, skuSuffix: true, variantValue: true, price: true }, orderBy: { id: 'asc' } },
    },
    orderBy: { sku: 'asc' },
  });

  const items: HeIncrease[] = [];
  let gstDiffers = 0;
  let examined = 0;
  for (const p of listings) {
    const gst = Number(p.taxPercent);
    const category = [p.category, p.subcategory].filter(Boolean).join(' › ');
    const rows = p.variants.length
      ? p.variants.map((v) => ({
          sku: String(v.skuSuffix), variantId: v.id as number | null,
          size: v.variantValue == null ? null : String(v.variantValue).replace(/[{}"]/g, ''), ours: Number(v.price ?? p.price),
        }))
      : [{ sku: p.sku, variantId: null as number | null, size: null as string | null, ours: Number(p.price) }];

    for (const r of rows) {
      const h = he.get(r.sku.toUpperCase());
      if (!h) continue;
      examined++;
      if (h.tax !== gst) { gstDiffers++; continue; }
      if (KEEP[r.sku.toUpperCase()] ?? KEEP[p.sku.toUpperCase()]) continue;
      const heEx = r2(h.incl / (1 + h.tax / 100));
      const row = withPrices({
        sku: r.sku, listingSku: p.sku, productId: p.id, variantId: r.variantId, name: p.name, size: r.size, category,
        ours: r.ours, gst, heIncl: h.incl, heEx, heTax: h.tax, target: 0, diff: 0, pct: null,
        heUpdatedAt: h.upd ? h.upd.slice(0, 10) : null, big: false,
      }, r.ours, gst);
      if (row) items.push(row);
    }
  }

  if (examined === 0) throw new Error('No listing matched the HE feed — keeping the last check.');
  items.sort((a, b) => b.diff - a.diff);
  return { checkedAt: new Date().toISOString(), items: items.slice(0, MAX_STORED), total: items.length, gstDiffers, examined };
}

export async function saveHeWatch(snapshot: HeWatchSnapshot): Promise<void> {
  const prev = await readHeWatch();
  if (prev && prev.examined > 0 && snapshot.examined < prev.examined * MIN_EXAMINED_RATIO) {
    throw new Error(
      `HE feed matched only ${snapshot.examined} sizes (${prev.examined} last time) — not saved, the last check is kept.`
    );
  }
  const value = JSON.stringify(snapshot);
  await prisma.setting.upsert({
    where: { key: HE_WATCH_KEY },
    create: { key: HE_WATCH_KEY, value, dataType: 'json' },
    update: { value, dataType: 'json' },
  });
}

/** Tolerant read — a missing or broken row is "not checked yet", never an error. */
export async function readHeWatch(): Promise<HeWatchSnapshot | null> {
  const row = await prisma.setting.findUnique({ where: { key: HE_WATCH_KEY } });
  if (!row?.value) return null;
  try {
    const s = JSON.parse(row.value);
    return s && Array.isArray(s.items) ? (s as HeWatchSnapshot) : null;
  } catch {
    return null;
  }
}

/**
 * The stored rises re-checked against our prices as they are NOW. HE's side stays as of the last check, but a
 * size raised from the product page drops off at once instead of nagging until the next nightly run.
 */
export async function currentIncreases(snapshot: HeWatchSnapshot): Promise<HeIncrease[]> {
  const ids = Array.from(new Set(snapshot.items.map((i) => i.productId)));
  if (!ids.length) return [];
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, price: true, taxPercent: true, variants: { select: { id: true, skuSuffix: true, price: true } } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const out: HeIncrease[] = [];
  for (const item of snapshot.items) {
    // KEEP may have grown since the snapshot was taken; an owner-fixed price must stop nagging at once.
    if (KEEP[item.sku.toUpperCase()] ?? KEEP[item.listingSku.toUpperCase()]) continue;
    const p = byId.get(item.productId);
    if (!p || p.status !== 'active') continue;
    let ours = Number(p.price);
    if (item.variantId != null) {
      const v = p.variants.find((x) => x.id === item.variantId);
      if (!v || String(v.skuSuffix) !== item.sku) continue;
      ours = Number(v.price ?? p.price);
    }
    const row = withPrices(item, ours, Number(p.taxPercent));
    if (row) out.push(row);
  }
  return out.sort((a, b) => b.diff - a.diff);
}

/** What a user has already been shown: SKU → the price we asked for then. */
export type SeenMap = Record<string, number>;

export async function readSeen(userId: number): Promise<SeenMap> {
  const row = await prisma.setting.findUnique({ where: { key: `${HE_WATCH_SEEN_PREFIX}${userId}` } });
  if (!row?.value) return {};
  try {
    const m = JSON.parse(row.value);
    return m && typeof m === 'object' && !Array.isArray(m) ? (m as SeenMap) : {};
  } catch {
    return {};
  }
}

export async function saveSeen(userId: number, items: HeIncrease[]): Promise<void> {
  const key = `${HE_WATCH_SEEN_PREFIX}${userId}`;
  const value = JSON.stringify(Object.fromEntries(items.map((i) => [i.sku.toUpperCase(), i.target])));
  await prisma.setting.upsert({ where: { key }, create: { key, value, dataType: 'json' }, update: { value, dataType: 'json' } });
}

/**
 * A rise is new to a user when they were never shown that SKU, or HE has gone up again since. Sizes fixed in
 * the meantime simply drop out, so raising some of them does not bring the pop-up back.
 */
export function isNewTo(seen: SeenMap, item: HeIncrease): boolean {
  const before = seen[item.sku.toUpperCase()];
  return typeof before !== 'number' || item.target > before + MIN_DIFF;
}
