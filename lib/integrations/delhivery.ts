/**
 * Delhivery. Same house style as razorpay.ts / shiprocket.ts.
 *
 * Two things about this API differ from every other integration here and are
 * worth knowing before changing anything:
 *
 *  1. Order creation is NOT plain JSON. It is form-encoded as
 *     `format=json&data=<json>`. Posting a JSON body silently fails.
 *  2. The rate API is capped at 40 requests/minute per their docs, and going
 *     over gets the IP throttled — so it is called once per shipment quote,
 *     never per row of a list.
 *
 * Docs: https://delhivery-express-api-doc.readme.io/
 */
import {
  getCreds,
  type DelhiveryCreds,
} from '../integration-credentials';
import type {
  Address, PackageSpec, QuoteOption, CreateShipmentInput,
  CreateShipmentResult, TrackResult,
} from '../shipping-providers';
import { mapCourierStatus, chargeableGrams } from '../shipping-providers';

const PROD = 'https://track.delhivery.com';
const STAGING = 'https://staging-express.delhivery.com';

export class DelhiveryError extends Error {}

function baseUrl(creds: DelhiveryCreds): string {
  return creds.useStaging ? STAGING : PROD;
}

async function creds(): Promise<DelhiveryCreds> {
  const c = await getCreds<DelhiveryCreds>('delhivery');
  if (!c) throw new DelhiveryError('Delhivery is not configured');
  return c;
}

/** Delhivery answers with several error shapes; surface whichever it used. */
function readError(status: number, body: string): string {
  try {
    const j = JSON.parse(body);
    if (typeof j?.error === 'string') return j.error;
    if (typeof j?.message === 'string') return j.message;
    if (Array.isArray(j?.rmk) && j.rmk.length) return String(j.rmk[0]);
    if (Array.isArray(j?.packages) && j.packages[0]?.remarks?.length) {
      return String(j.packages[0].remarks.join(' | '));
    }
  } catch {
    /* fall through */
  }
  return `Delhivery ${status}: ${body.slice(0, 300)}`;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const c = await creds();
  const res = await fetch(`${baseUrl(c)}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      // Delhivery's scheme — note "Token", not "Bearer".
      Authorization: `Token ${c.apiToken}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('[delhivery]', path, 'failed:', res.status, text);
    throw new DelhiveryError(readError(res.status, text));
  }
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    // Some endpoints (packing slip) answer with a non-JSON body.
    return text as unknown as T;
  }
}

/** Real authenticated call for Test connection — a pincode lookup is the
 *  cheapest request that still proves the token works. */
export async function testDelhivery(): Promise<{ ok: true; detail: string }> {
  const c = await creds();
  const r = await call<any>(`/c/api/pin-codes/json/?filter_codes=110001`);
  const list = r?.delivery_codes ?? [];
  return {
    ok: true,
    detail: list.length
      ? `Connected${c.useStaging ? ' (STAGING)' : ''}. Client: ${c.clientName}`
      : `Token accepted${c.useStaging ? ' (STAGING)' : ''}, but the pincode lookup returned nothing`,
  };
}

/** True/false plus the reason. Delhivery answers an unserviceable pincode with
 *  an empty list (their docs call the state "NSZ"). */
export async function delhiveryServiceable(
  pincode: string,
): Promise<{ serviceable: boolean; prepaid: boolean; note: string | null }> {
  const r = await call<any>(`/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pincode)}`);
  const entry = r?.delivery_codes?.[0]?.postal_code;
  if (!entry) return { serviceable: false, prepaid: false, note: 'Pincode not serviceable (NSZ)' };
  return {
    serviceable: true,
    // "Y" means prepaid is NOT available on this pincode.
    prepaid: String(entry.pre_paid ?? 'Y').toUpperCase() === 'Y',
    note: entry.district ? `${entry.district}, ${entry.state_code}` : null,
  };
}

export async function delhiveryQuote(
  fromPincode: string,
  to: Address,
  pkg: PackageSpec,
): Promise<QuoteOption[]> {
  const svc = await delhiveryServiceable(to.pincode);
  if (!svc.serviceable) {
    return [{
      provider: 'delhivery' as const,
      courierId: 'delhivery-surface',
      courierName: 'Delhivery',
      charge: 0,
      etaDays: null,
      chargeableWeightGrams: null,
      rating: null,
      serviceable: false,
      note: svc.note,
    }];
  }

  const grams = chargeableGrams(pkg);
  const q = new URLSearchParams({
    md: 'S',                 // Surface. "E" is Express.
    ss: 'Delivered',         // rate for a successful delivery, not an RTO
    cgm: String(grams),      // chargeable weight, GRAMS
    o_pin: fromPincode,
    d_pin: to.pincode,
    pt: 'Pre-paid',
  });
  const r = await call<any>(`/api/kinko/v1/invoice/charges/.json?${q}`);
  const row = Array.isArray(r) ? r[0] : r;
  const total = Number(row?.total_amount ?? 0);
  return [{
    provider: 'delhivery' as const,
    courierId: 'delhivery-surface',
    courierName: 'Delhivery Surface',
    charge: total,
    etaDays: null,
    chargeableWeightGrams: grams,
    rating: null,
    serviceable: true,
    // Their own docs call this approximate; say so rather than implying it is
    // the invoice figure.
    note: svc.note ? `${svc.note} · estimate` : 'estimate',
  }];
}

export async function delhiveryCreate(input: CreateShipmentInput): Promise<CreateShipmentResult> {
  const c = await creds();
  const grams = input.pkg.weightGrams;

  const shipment: Record<string, unknown> = {
    name: input.to.name,
    add: input.to.address,
    city: input.to.city,
    state: input.to.state,
    country: 'India',
    pin: input.to.pincode,
    phone: input.to.phone,
    order: input.orderNumber,
    payment_mode: 'Prepaid', // owner's decision: no COD anywhere
    cod_amount: 0,
    total_amount: input.declaredValue,
    weight: grams,
    quantity: input.lines.reduce((s, l) => s + l.units, 0),
    products_desc: input.lines.map((l) => l.name).join(', ').slice(0, 250),
    hsn_code: input.lines[0]?.hsn ?? undefined,
    shipment_length: input.pkg.lengthCm ?? undefined,
    shipment_width: input.pkg.breadthCm ?? undefined,
    shipment_height: input.pkg.heightCm ?? undefined,
  };

  const payload = {
    shipments: [shipment],
    pickup_location: { name: input.pickupLocation ?? c.pickupLocation ?? c.clientName },
  };

  // Form-encoded, NOT JSON — see the header note.
  const body = new URLSearchParams({ format: 'json', data: JSON.stringify(payload) });
  const r = await call<any>('/api/cmu/create.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const pkgRes = r?.packages?.[0];
  // Delhivery answers 200 with success:false — the HTTP status alone is not
  // enough to know a booking worked.
  if (!pkgRes || pkgRes.status === 'Fail' || r?.success === false) {
    const why = pkgRes?.remarks?.join(' | ') || r?.rmk || 'Delhivery rejected the shipment';
    throw new DelhiveryError(String(why));
  }
  return {
    courierOrderId: String(pkgRes.refnum ?? input.orderNumber),
    shipmentRef: null,
    awb: pkgRes.waybill ? String(pkgRes.waybill) : null,
    courierName: 'Delhivery',
    raw: r,
  };
}

export async function delhiveryPickup(
  pickupLocation: string,
  when: Date,
  packageCount: number,
): Promise<unknown> {
  const body = {
    pickup_location: pickupLocation,
    pickup_date: when.toISOString().slice(0, 10),
    pickup_time: when.toISOString().slice(11, 19),
    expected_package_count: packageCount,
  };
  return call<any>('/fm/request/new/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Packing slip / label. Returns whatever URL Delhivery gives, else null so
 *  the UI can say "not available" instead of opening a broken link. */
export async function delhiveryLabel(awb: string): Promise<string | null> {
  const r = await call<any>(`/api/p/packing_slip?wbns=${encodeURIComponent(awb)}&pdf=true`);
  const pkg = r?.packages?.[0];
  return pkg?.pdf_download_link ?? null;
}

export async function delhiveryTrack(awb: string): Promise<TrackResult> {
  const r = await call<any>(`/api/v1/packages/json/?waybill=${encodeURIComponent(awb)}`);
  const s = r?.ShipmentData?.[0]?.Shipment;
  const current = s?.Status?.Status ?? '';
  const scans = s?.Scans ?? [];
  return {
    awb,
    currentStatus: String(current),
    mapped: mapCourierStatus(current),
    events: scans.map((sc: any) => {
      const d = sc?.ScanDetail ?? {};
      return {
        status: String(d.Scan ?? d.ScanType ?? ''),
        mapped: mapCourierStatus(d.Scan ?? d.ScanType),
        detail: d.Instructions ?? null,
        location: d.ScannedLocation ?? null,
        occurredAt: d.ScanDateTime ? new Date(d.ScanDateTime) : new Date(),
        raw: sc,
      };
    }),
    raw: r,
  };
}

export async function delhiveryCancel(awb: string): Promise<unknown> {
  return call<any>('/api/p/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ waybill: awb, cancellation: 'true' }),
  });
}
