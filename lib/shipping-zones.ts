/**
 * Zone × weight delivery-charge engine. DUPLICATED from web/lib/shipping-zones.ts
 * — keep both in sync (the web display and this binding charge must match).
 *
 *   weight \ zone      West  Central North South  East
 *   ≤ 100 g             70    70     70    70     100
 *   ≤ 500 g            100   100    100   100     200
 *   ≤ 1000 g (1 kg)    250   250    250   250     350
 *   > 1000 g (1–10 kg  100   200    200   200     200
 *     and > 10 kg)
 *   free order:        West/Central/North/South ≥ ₹5,000 · East ≥ ₹10,000
 *
 * Missing-weight items default to the 500–1000 g bracket (DEFAULT_ITEM_GRAMS).
 */

export type Zone = 'West' | 'East' | 'North' | 'South' | 'Central';

export const FREE_ORDER_THRESHOLD: Record<Zone, number> = {
  West: 5000,
  Central: 5000,
  North: 5000,
  South: 5000,
  East: 10000,
};
export const DEFAULT_ITEM_GRAMS = 750;
const FALLBACK_ZONE: Zone = 'West';

// Charge matrix: zone → [≤100 g, ≤500 g, ≤1000 g, >1000 g]. The >1000 g bracket
// covers both 1–10 kg and >10 kg (same rate). Home zone (West) is cheapest on
// heavy items (₹100); all other zones ₹200.
const MATRIX: Record<Zone, [number, number, number, number]> = {
  West: [70, 100, 250, 100],
  Central: [70, 100, 250, 200],
  North: [70, 100, 250, 200],
  South: [70, 100, 250, 200],
  East: [100, 200, 350, 200],
};

const STATE_ZONE: Record<string, Zone> = {
  // North
  'delhi': 'North', 'new delhi': 'North', 'haryana': 'North', 'punjab': 'North',
  'himachal pradesh': 'North', 'jammu and kashmir': 'North', 'jammu & kashmir': 'North',
  'ladakh': 'North', 'uttarakhand': 'North', 'uttar pradesh': 'North',
  'rajasthan': 'North', 'chandigarh': 'North', 'bihar': 'North', // Bihar → North (owner override)
  // West
  'maharashtra': 'West', 'gujarat': 'West', 'goa': 'West',
  'dadra and nagar haveli': 'West', 'daman and diu': 'West',
  'dadra and nagar haveli and daman and diu': 'West',
  // Central (owner spec — MP + Chhattisgarh moved out of West)
  'madhya pradesh': 'Central', 'chhattisgarh': 'Central',
  // South
  'karnataka': 'South', 'tamil nadu': 'South', 'kerala': 'South',
  'andhra pradesh': 'South', 'telangana': 'South', 'puducherry': 'South',
  'lakshadweep': 'South', 'andaman and nicobar islands': 'South',
  'west bengal': 'South', // West Bengal → South (owner override)
  // East + North-East
  'jharkhand': 'East', 'odisha': 'East',
  'assam': 'East', 'sikkim': 'East', 'arunachal pradesh': 'East', 'nagaland': 'East',
  'manipur': 'East', 'mizoram': 'East', 'tripura': 'East', 'meghalaya': 'East',
};

export function zoneForState(state: string | null | undefined): Zone {
  if (!state) return FALLBACK_ZONE;
  return STATE_ZONE[state.trim().toLowerCase()] ?? FALLBACK_ZONE;
}

/**
 * Parse a free-text weight into grams. Tolerant of the formats a person
 * actually types: "250", "250g", "250 g", "250gm", "250 gms", "250 grams",
 * "1.5kg", "1 kilo", "2kg 370g". Returns null only when nothing parseable.
 */
export function parseGrams(weight: string | null | undefined): number | null {
  if (weight == null) return null;
  const s = String(weight).toLowerCase().trim();
  if (!s) return null;

  let total = 0;
  let matched = false;

  // Kilograms: "kg", "kgs", "kilo(s)", "kilogram(s)".
  const kgRe = /(\d+(?:\.\d+)?)\s*(?:kgs?|kilo(?:gram)?s?)\b/g;
  for (let m = kgRe.exec(s); m; m = kgRe.exec(s)) {
    total += parseFloat(m[1]) * 1000;
    matched = true;
  }

  // Grams: "g", "gm(s)", "gram(s)". Strip kg tokens first so the "g" inside
  // a "kg" token is never miscounted as grams.
  const withoutKg = s.replace(/(\d+(?:\.\d+)?)\s*(?:kgs?|kilo(?:gram)?s?)\b/g, ' ');
  const gRe = /(\d+(?:\.\d+)?)\s*(?:gms?|grams?|g)\b/g;
  for (let m = gRe.exec(withoutKg); m; m = gRe.exec(withoutKg)) {
    total += parseFloat(m[1]);
    matched = true;
  }

  if (matched && total > 0) return Math.round(total);

  // Bare number with no unit → assume grams ("250", "0.5").
  const bare = s.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
  if (bare) return Math.round(parseFloat(bare[1]));
  return null;
}

export function orderWeightGrams(items: Array<{ weight?: string | null; quantity: number }>): number {
  let total = 0;
  for (const it of items) {
    const g = parseGrams(it.weight) ?? DEFAULT_ITEM_GRAMS;
    total += g * (it.quantity || 1);
  }
  return total;
}

function bracketIndex(grams: number): 0 | 1 | 2 | 3 {
  if (grams <= 100) return 0;
  if (grams <= 500) return 1;
  if (grams <= 1000) return 2;
  return 3;
}

export function zoneWeightShipping(
  zone: Zone,
  totalGrams: number,
  orderValueAfterDiscount: number,
): number {
  if (orderValueAfterDiscount >= FREE_ORDER_THRESHOLD[zone]) return 0;
  return MATRIX[zone][bracketIndex(totalGrams)];
}
