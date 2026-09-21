/**
 * GET /api/public/pincode?pin=411048 — "Do you deliver to my pincode?" for the
 * product page. Public (no login), called by the storefront's own
 * /api/pincode, which rate-limits per visitor before it gets here.
 *
 * Answers from Delhivery's serviceability API, plus OUR free-delivery
 * threshold for that pincode's zone (East ₹10,000, the rest ₹5,000 — the same
 * table checkout charges from), so the page can say "Free delivery" honestly.
 *
 * Serviceability barely changes day to day, so each pincode is cached for a
 * day here AND at the CDN: Delhivery sees roughly one call per pincode per day
 * no matter how many shoppers type it.
 *
 * Deliberately says nothing about the courier's rate — that is our cost, not
 * the customer's price.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCreds } from '@/lib/integration-credentials';
import { delhiveryServiceable, delhiveryTat } from '@/lib/integrations/delhivery';
import { FREE_ORDER_THRESHOLD, zoneForState } from '@/lib/shipping-zones';
import type { DelhiveryCreds } from '@/lib/integration-credentials';

export const dynamic = 'force-dynamic';

type Answer = {
  pincode: string;
  serviceable: boolean;
  place: string | null;
  state: string | null;
  etaDays: number | null;
  freeDeliveryAbove: number;
  note: string | null;
};

const DAY = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; answer: Answer }>();

function reply(body: unknown, status = 200, cacheable = true) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': cacheable ? 'public, s-maxage=86400, stale-while-revalidate=3600' : 'no-store',
    },
  });
}

export async function GET(req: NextRequest) {
  const pin = new URL(req.url).searchParams.get('pin')?.trim() ?? '';
  if (!/^[1-9]\d{5}$/.test(pin)) return reply({ error: 'Enter a valid 6-digit pincode' }, 400, false);

  const hit = cache.get(pin);
  if (hit && Date.now() - hit.at < DAY) return reply(hit.answer);

  const creds = await getCreds<DelhiveryCreds>('delhivery');
  if (!creds) return reply({ error: 'Pincode check is not available right now' }, 503, false);

  try {
    const svc = await delhiveryServiceable(pin);
    const state = svc.stateName;
    const origin = creds.pickupPincode && /^\d{6}$/.test(creds.pickupPincode) ? creds.pickupPincode : '411048';
    const etaDays = svc.serviceable ? await delhiveryTat(origin, pin).catch(() => null) : null;
    const answer: Answer = {
      pincode: pin,
      serviceable: svc.serviceable,
      place: svc.district ? titleCase(svc.district) : null,
      state,
      etaDays,
      // Unknown state → the HIGHEST threshold, so the page never promises free
      // delivery that checkout would then charge for.
      freeDeliveryAbove: state ? FREE_ORDER_THRESHOLD[zoneForState(state)] : Math.max(...Object.values(FREE_ORDER_THRESHOLD)),
      note: svc.serviceable ? null : svc.note,
    };
    cache.set(pin, { at: Date.now(), answer });
    if (cache.size > 5000) cache.delete(cache.keys().next().value as string);
    return reply(answer);
  } catch (e) {
    console.error('[public/pincode]', pin, e instanceof Error ? e.message : e);
    return reply({ error: 'Could not check this pincode right now — please try again' }, 502, false);
  }
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
  });
}
