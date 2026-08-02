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
 * The default is +30% and add: Hotelic Essentials holds trade prices without
 * GST, we sell at retail with GST in.
 *
 * Order does not matter — both steps are multiplications.
 */

export const PRICE_PERCENT_KEY = 'sync_import_price_percent';
export const GST_MODE_KEY = 'sync_import_gst_mode';

export const DEFAULT_PRICE_PERCENT = 30;
export const DEFAULT_GST_MODE: GstMode = 'add';

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
  return {
    sample,
    tax_percent: taxPercent,
    result: applyPricingRule(sample, taxPercent, rule),
    note: pricingNote(taxPercent, rule),
  };
}
