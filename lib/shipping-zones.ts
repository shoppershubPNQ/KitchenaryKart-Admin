/**
 * Zone × weight delivery-charge engine. DUPLICATED from web/lib/shipping-zones.ts
 * — keep both in sync (the web display and this binding charge must match).
 *
 *   weight \ zone   West   East   North  South
 *   ≤ 100 g         FREE   100    FREE   FREE
 *   ≤ 500 g         100    200    100    100
 *   ≤ 1000 g        250    350    250    250
 *   > 1000 g        FREE   500    FREE   FREE
 *   free order:     West/North/South ≥ ₹5,000 · East ≥ ₹10,000
 *
 * Missing-weight items default to the 500–1000 g bracket (DEFAULT_ITEM_GRAMS).
 */

export type Zone = 'West' | 'East' | 'North' | 'South';

export const FREE_ORDER_THRESHOLD: Record<Zone, number> = {
  West: 5000,
  North: 5000,
  South: 5000,
  East: 10000,
};
export const DEFAULT_ITEM_GRAMS = 750;
const FALLBACK_ZONE: Zone = 'West';

const MATRIX: Record<Zone, [number, number, number, number]> = {
  West: [0, 100, 250, 0],
  East: [100, 200, 350, 500],
  North: [0, 100, 250, 0],
  South: [0, 100, 250, 0],
};

const STATE_ZONE: Record<string, Zone> = {
  // North
  'delhi': 'North', 'new delhi': 'North', 'haryana': 'North', 'punjab': 'North',
  'himachal pradesh': 'North', 'jammu and kashmir': 'North', 'jammu & kashmir': 'North',
  'ladakh': 'North', 'uttarakhand': 'North', 'uttar pradesh': 'North',
  'rajasthan': 'North', 'chandigarh': 'North', 'bihar': 'North', // Bihar → North (owner override)
  // West
  'maharashtra': 'West', 'gujarat': 'West', 'goa': 'West', 'madhya pradesh': 'West',
  'chhattisgarh': 'West', 'dadra and nagar haveli': 'West', 'daman and diu': 'West',
  'dadra and nagar haveli and daman and diu': 'West',
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

export function parseGrams(weight: string | null | undefined): number | null {
  if (!weight) return null;
  const s = String(weight).toLowerCase();
  const kg = s.match(/(\d+(?:\.\d+)?)\s*kg/);
  const g = s.match(/(\d+(?:\.\d+)?)\s*g(?![a-z])/);
  let total = 0;
  if (kg) total += parseFloat(kg[1]) * 1000;
  if (g) total += parseFloat(g[1]);
  if (total > 0) return Math.round(total);
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
