import { prisma } from '@/lib/db';

/**
 * The commercial terms of the partner link — how money is re-priced on the way
 * in, and who decides.
 *
 * These used to be constants in this file. They are settings now, because a
 * trade markup is a commercial decision that changes without a deploy: the Sync
 * screen edits both, and every price, MRP, variant and preview diff moves with
 * them.
 *
 *   percent  signed. +30 adds 30% to every imported price; -30 takes 30% off;
 *            0 leaves the figure be.
 *   gstMode  'add' when the partner's price EXCLUDES tax and ours should
 *            include it, 'remove' for the reverse, 'none' to leave tax alone.
 *
 * The default is +30% and NONE: Hotelic Essentials publishes its prices with
 * GST already included (that is how its catalogue stores them), so "their
 * price plus 30%" is a straight markup. 'add' on top of that would charge the
 * tax twice — it is only right for a partner that publishes ex-GST.
 *
 * Order does not matter — both steps are multiplications.
 */

export const PRICE_PERCENT_KEY = 'sync_import_price_percent';
export const GST_MODE_KEY = 'sync_import_gst_mode';

export const DEFAULT_PRICE_PERCENT = 30;
export const DEFAULT_GST_MODE: GstMode = 'none';

/** Applied when the partner states no rate. An explicit 0 is honoured as zero-rated. */
export const DEFAULT_GST_PERCENT = 18;

export type GstMode = 'remove' | 'add' | 'none';

export interface PricingRule {
  percent: number;
  gstMode: GstMode;
}

/** The rate to use for a listing: theirs when stated, the default when not. */
export function effectiveGstPercent(taxPercent: number | null | undefined): number {
  if (taxPercent === null || taxPercent === undefined) return DEFAULT_GST_PERCENT;
  const rate = Number(taxPercent);
  if (!Number.isFinite(rate) || rate < 0) return DEFAULT_GST_PERCENT;
  return rate;
}

/** Re-prices one figure, rounded to paise because the column is Decimal(10,2). */
export function applyPricingRule(
  rupees: number,
  taxPercent: number | null | undefined,
  rule: PricingRule,
): number {
  const gross = Number(rupees);
  if (!Number.isFinite(gross) || gross <= 0) return 0;

  const adjusted = gross * (1 + rule.percent / 100);
  if (rule.gstMode === 'none') return round2(adjusted);

  const rate = effectiveGstPercent(taxPercent);
  const factor = 1 + rate / 100;
  return round2(rule.gstMode === 'remove' ? adjusted / factor : adjusted * factor);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Human-readable summary of what the rule did, for the review diff. */
export function pricingNote(taxPercent: number | null | undefined, rule: PricingRule): string {
  const rate = effectiveGstPercent(taxPercent);
  const step =
    rule.percent === 0
      ? 'Their price'
      : rule.percent < 0
        ? `Their price less ${Math.abs(rule.percent)}%`
        : `Their price plus ${rule.percent}%`;

  if (rule.gstMode === 'none') return `${step} (GST left as-is).`;
  if (rate === 0) return `${step} (zero-rated, so GST is not ${rule.gstMode}ed).`;
  return rule.gstMode === 'remove'
    ? `${step}, then less ${rate}% GST.`
    : `${step}, then plus ${rate}% GST.`;
}

/**
 * MRP is twice the selling price. Not invented here — it is what the
 * catalogue already does: 1,410 of the 1,420 products carrying an MRP are at
 * exactly 2x, which is the "SAVE 50%" the storefront shows.
 *
 * Deriving it also repairs two things the partner's own MRP could not. Some
 * of their listings publish an MRP of 0 (KKHE0237-ERS4T-P among them), which
 * carried through as an MRP of 0 here; and one product had drifted to an MRP
 * BELOW its price (KKHE0152-WLX2A at 1,11,215 against 19,942).
 */
export const MRP_MULTIPLE = 2;

export interface PriceChain {
  /** What the partner publishes: GST already included. */
  partner: number;
  /** 1. their price with GST taken out — the trade figure to mark up. */
  exGst: number;
  /** 2. plus the markup. */
  marked: number;
  /** 3. plus GST again: what we sell it for. */
  price: number;
  /** 4. the struck-through figure beside it. */
  mrp: number;
  gstPercent: number;
  markupPercent: number;
}

/**
 * The price chain, written out step by step:
 *
 *     HE ex-GST  x  1.30  x  1.18
 *
 * Every figure the owner reads comes from here, so the arithmetic is one
 * expression rather than something to reconstruct from two helpers.
 *
 * It is worth being plain that this is ARITHMETICALLY IDENTICAL to the older
 * `applyPricingRule(theirPrice, …)` under the default rule: dividing by
 * 1 + GST and multiplying back by it cancels, leaving their price x 1.30.
 * Six products were checked against the live catalogue and five matched to
 * the paisa; the sixth was a price of theirs that had moved. Writing the
 * chain out changes no price — it makes the steps visible.
 */
export function priceChain(
  partnerIncGst: number,
  taxPercent: number | null | undefined,
  rule: PricingRule,
): PriceChain {
  const gstPercent = effectiveGstPercent(taxPercent);
  const gross = Number(partnerIncGst);
  if (!Number.isFinite(gross) || gross <= 0) {
    return { partner: 0, exGst: 0, marked: 0, price: 0, mrp: 0, gstPercent, markupPercent: rule.percent };
  }

  const gstFactor = 1 + gstPercent / 100;
  const exGst = round2(gross / gstFactor);
  const marked = round2(exGst * (1 + rule.percent / 100));
  const price = round2(marked * gstFactor);

  return {
    partner: gross,
    exGst,
    marked,
    price,
    mrp: round2(price * MRP_MULTIPLE),
    gstPercent,
    markupPercent: rule.percent,
  };
}

/** One line describing the chain, for the admin to print under a price. */
export function chainNote(c: PriceChain): string {
  return (
    `HE ₹${c.exGst.toFixed(2)} ex-GST ` +
    `× ${(1 + c.markupPercent / 100).toFixed(2)} = ₹${c.marked.toFixed(2)} ` +
    `× ${(1 + c.gstPercent / 100).toFixed(2)} GST = ₹${c.price.toFixed(2)} ` +
    `· MRP ₹${c.mrp.toFixed(2)}`
  );
}

/** Clamped either side of a full write-off: -100% would zero every price. */
function clamp(percent: number): number {
  const parsed = Number(percent);
  if (!Number.isFinite(parsed)) return DEFAULT_PRICE_PERCENT;
  return Math.max(-95, Math.min(500, parsed));
}

export async function getPricingRule(): Promise<PricingRule> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: [PRICE_PERCENT_KEY, GST_MODE_KEY] } },
  });
  const value = (key: string) => rows.find((r) => r.key === key)?.value?.trim() ?? '';

  const rawPercent = value(PRICE_PERCENT_KEY);
  const percent = rawPercent === '' ? DEFAULT_PRICE_PERCENT : clamp(Number(rawPercent));

  const rawMode = value(GST_MODE_KEY);
  const gstMode: GstMode =
    rawMode === 'add' || rawMode === 'remove' || rawMode === 'none' ? rawMode : DEFAULT_GST_MODE;

  return { percent, gstMode };
}

export async function savePricingRule(percent: number, gstMode: GstMode): Promise<PricingRule> {
  const clamped = String(clamp(percent));
  for (const [key, val] of [
    [PRICE_PERCENT_KEY, clamped],
    [GST_MODE_KEY, gstMode],
  ] as const) {
    await prisma.setting.upsert({
      where: { key },
      update: { value: val },
      create: { key, value: val, dataType: 'string' },
    });
  }
  return getPricingRule();
}

/** A worked example for the settings form, so the effect is visible. */
export function pricingPreview(rule: PricingRule, sample = 1000, taxPercent = DEFAULT_GST_PERCENT) {
  const chain = priceChain(sample, taxPercent, rule);
  return {
    sample,
    tax_percent: taxPercent,
    result: applyPricingRule(sample, taxPercent, rule),
    note: pricingNote(taxPercent, rule),
    /** The same sum as four figures, so the steps can be read one by one. */
    chain: {
      ex_gst: chain.exGst,
      marked: chain.marked,
      price: chain.price,
      mrp: chain.mrp,
      markup_percent: chain.markupPercent,
      gst_percent: chain.gstPercent,
    },
  };
}
