/**
 * Offer ticker — the scrolling red offer strip under the storefront's home
 * hero. Stored as ONE JSON row in the settings table (key `offer_ticker`):
 *   { enabled, speed: 'slow' | 'normal' | 'fast', items: [{ text, href }] }
 * The storefront reads the same row (web/lib/offer-ticker.ts).
 */
import { z } from 'zod';

export const OFFER_TICKER_KEY = 'offer_ticker';

export const offerTickerSchema = z.object({
  enabled: z.boolean(),
  speed: z.enum(['slow', 'normal', 'fast']),
  items: z
    .array(
      z.object({
        text: z.string().trim().min(1, 'Every offer needs some text').max(140, 'Keep each offer under 140 characters'),
        href: z
          .string()
          .trim()
          .max(300)
          .nullable()
          .optional()
          .transform((v) => (v ? v : null))
          .refine((v) => !v || v.startsWith('/') || /^https?:\/\//i.test(v), 'A link must start with / or https://'),
      }),
    )
    .max(12, 'At most 12 offers'),
});

export type OfferTickerConfig = z.infer<typeof offerTickerSchema>;

export const EMPTY_TICKER: OfferTickerConfig = { enabled: false, speed: 'normal', items: [] };

/** Tolerant read of the stored row — a bad value shows as "off", never an error. */
export function parseOfferTicker(raw: string | null | undefined): OfferTickerConfig {
  if (!raw) return EMPTY_TICKER;
  try {
    const r = offerTickerSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : EMPTY_TICKER;
  } catch {
    return EMPTY_TICKER;
  }
}
