/**
 * Delhivery. Same house style as razorpay.ts / shiprocket.ts.
 *
 * Things about this API that differ from every other integration here, all
 * checked against delhivery-express-api-doc.readme.io (2026-09-21):
 *
 *  1. Order creation is NOT plain JSON. It is form-encoded as
 *     `format=json&data=<json>`. Posting a JSON body silently fails.
 *  2. The rate API is capped at 40 requests/minute, and going over gets the IP
 *     throttled — so it is called once per shipment quote, never per list row.
 *     Tracking allows 750 requests / 5 min per IP.
 *  3. Timestamps carry no zone and are IST — always parse with delhiveryTime().
 *  4. Status words are reused for a parcel coming BACK ("In Transit" with type
 *     RT) — always map with mapDelhiveryStatus(status, type), never the words
 *     alone.
 *  5. Seller GSTIN and HSN are mandatory on manifestation; an e-way bill is
 *     mandatory above ₹50,000; the payload must not contain & # % ; \.
 *  6. The order id must be unique per booking when we let Delhivery assign the
 *     waybill — a re-booking of the same order needs a new reference.
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
import { mapDelhiveryStatus, delhiveryTime, chargeableGrams } from '../shipping-providers';

const PROD = 'https://track.delhivery.com';
const STAGING = 'https://staging-express.delhivery.com';

/** The legal limit above which an e-way bill must travel with the goods. */
export const EWAYBILL_THRESHOLD = 50000;

export class DelhiveryError extends Error {}

function baseUrl(creds: DelhiveryCreds): string {
  return creds.useStaging ? STAGING : PROD;
}

export async function delhiveryCreds(): Promise<DelhiveryCreds> {
  const c = await getCreds<DelhiveryCreds>('delhivery');
  if (!c) throw new DelhiveryError('Delhivery is not configured — add the API token in Integrations');
  return c;
}

/** Delhivery answers with several error shapes; surface whichever it used. */
function readError(status: number, body: string): string {
  try {
    const j = JSON.parse(body);
    if (typeof j?.error === 'string') return j.error;
    if (typeof j?.message === 'string') return j.message;
    if (typeof j?.detail === 'string') return j.detail;
    if (Array.isArray(j?.rmk) && j.rmk.length) return String(j.rmk[0]);
    if (typeof j?.rmk === 'string') return j.rmk;
    if (Array.isArray(j?.packages) && j.packages[0]?.remarks?.length) {
      return String(j.packages[0].remarks.join(' | '));
    }
  } catch {
    /* fall through */
  }
  if (status === 401 || status === 403) return 'Delhivery rejected the API token (check it in Integrations)';
  return `Delhivery ${status}: ${body.slice(0, 300)}`;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const c = await delhiveryCreds();
  const res = await fetch(`${baseUrl(c)}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      // Delhivery's scheme — note "Token", not "Bearer".
      Authorization: `Token ${c.apiToken}`,
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('[delhivery]', path.split('?')[0], 'failed:', res.status, text.slice(0, 500));
    throw new DelhiveryError(readError(res.status, text));
  }
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    // Some endpoints (packing slip) answer with a non-JSON body.
    return text as unknown as T;
  }
}

/**
 * Delhivery's system rejects & # % ; and backslash in manifestation data
 * (order-creation docs, note 8). Real addresses here contain "Unit # 2" and
 * "Molecule & Esha's salon", so they are rewritten, not dropped.
 */
export function cleanForDelhivery(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, ' and ')
    .replace(/#/g, ' No. ')
    .replace(/%/g, ' pct ')
    .replace(/[;\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Real authenticated call for Test connection — a pincode lookup is the
 *  cheapest request that still proves the token works. */
export async function testDelhivery(): Promise<{ ok: true; detail: string }> {
  const c = await delhiveryCreds();
  const r = await call<any>(`/c/api/pin-codes/json/?filter_codes=110001`);
  const list = r?.delivery_codes ?? [];
  return {
    ok: true,
    detail: list.length
      ? `Connected${c.useStaging ? ' (STAGING)' : ''}. Client: ${c.clientName}`
      : `Token accepted${c.useStaging ? ' (STAGING)' : ''}, but the pincode lookup returned nothing`,
  };
}

/** Delhivery returns a state CODE; our zone table is keyed by name. */
export const STATE_BY_CODE: Record<string, string> = {
  AN: 'Andaman and Nicobar Islands', AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam',
  BR: 'Bihar', CH: 'Chandigarh', CG: 'Chhattisgarh', CT: 'Chhattisgarh', DN: 'Dadra and Nagar Haveli',
  DD: 'Daman and Diu', DL: 'Delhi', GA: 'Goa', GJ: 'Gujarat', HR: 'Haryana', HP: 'Himachal Pradesh',
  JK: 'Jammu and Kashmir', JH: 'Jharkhand', KA: 'Karnataka', KL: 'Kerala', LA: 'Ladakh', LD: 'Lakshadweep',
  MP: 'Madhya Pradesh', MH: 'Maharashtra', MN: 'Manipur', ML: 'Meghalaya', MZ: 'Mizoram', NL: 'Nagaland',
  OR: 'Odisha', OD: 'Odisha', PY: 'Puducherry', PB: 'Punjab', RJ: 'Rajasthan', SK: 'Sikkim',
  TN: 'Tamil Nadu', TS: 'Telangana', TG: 'Telangana', TR: 'Tripura', UP: 'Uttar Pradesh',
  UK: 'Uttarakhand', UT: 'Uttarakhand', WB: 'West Bengal',
};

export interface Serviceability {
  serviceable: boolean;
  /** Prepaid delivery available on this pincode ("pre_paid": "Y"). */
  prepaid: boolean;
  district: string | null;
  stateCode: string | null;
  /** Full state name for stateCode — the pincode decides the state, so this
   *  overrides whatever the address text said. */
  stateName: string | null;
  note: string | null;
}

/** Delhivery answers an unserviceable pincode with an empty list (their docs
 *  call it "NSZ"), and an embargoed one with remarks "Embargo". */
export async function delhiveryServiceable(pincode: string): Promise<Serviceability> {
  if (!/^\d{6}$/.test(pincode)) {
    return { serviceable: false, prepaid: false, district: null, stateCode: null, stateName: null, note: 'Not a valid 6-digit pincode' };
  }
  const r = await call<any>(`/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pincode)}`);
  const entry = r?.delivery_codes?.[0]?.postal_code;
  if (!entry) {
    return { serviceable: false, prepaid: false, district: null, stateCode: null, stateName: null, note: 'Pincode not serviceable by Delhivery' };
  }
  const embargo = String(entry.remarks ?? '').toLowerCase().includes('embargo');
  const prepaid = String(entry.pre_paid ?? '').toUpperCase() === 'Y';
  return {
    // Every order here is prepaid (no COD), so prepaid availability IS
    // serviceability for us.
    serviceable: prepaid && !embargo,
    prepaid,
    district: entry.district ? String(entry.district) : null,
    stateCode: entry.state_code ? String(entry.state_code) : null,
    stateName: entry.state_code ? STATE_BY_CODE[String(entry.state_code).toUpperCase()] ?? null : null,
    note: embargo ? 'Delivery to this pincode is temporarily suspended (embargo)' : !prepaid ? 'Prepaid delivery not offered on this pincode' : null,
  };
}

export async function delhiveryQuote(
  fromPincode: string,
  to: Address,
  pkg: PackageSpec,
): Promise<QuoteOption[]> {
  const svc = await delhiveryServiceable(to.pincode);
  const where = svc.district ? `${svc.district}, ${svc.stateCode}` : null;
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
  const eta = await delhiveryTat(fromPincode, to.pincode).catch(() => null);
  return [{
    provider: 'delhivery' as const,
    courierId: 'delhivery-surface',
    courierName: 'Delhivery Surface',
    charge: total,
    etaDays: eta,
    chargeableWeightGrams: grams,
    rating: null,
    serviceable: true,
    // Their own docs call this approximate; say so rather than implying it is
    // the invoice figure.
    note: where ? `${where} · estimate` : 'estimate',
  }];
}

/**
 * Expected transit days, origin → destination, surface. NOT in the public
 * readme docs (it is a Delhivery One endpoint), so it is strictly best-effort:
 * any error or an implausible answer returns null and callers show no ETA,
 * rather than a made-up one.
 */
export async function delhiveryTat(fromPincode: string, toPincode: string): Promise<number | null> {
  const q = new URLSearchParams({ origin_pin: fromPincode, destination_pin: toPincode, mot: 'S', pdt: 'B2C' });
  const r = await call<any>(`/api/dc/expected_tat?${q}`);
  const n = Number(r?.data?.tat ?? r?.tat ?? r?.data?.expected_tat ?? NaN);
  return Number.isFinite(n) && n > 0 && n < 30 ? Math.round(n) : null;
}

export async function delhiveryCreate(input: CreateShipmentInput): Promise<CreateShipmentResult> {
  const c = await delhiveryCreds();
  const grams = input.pkg.weightGrams;

  if (input.declaredValue > EWAYBILL_THRESHOLD && !input.ewaybill?.trim()) {
    throw new DelhiveryError(`Shipment value is above ₹${EWAYBILL_THRESHOLD.toLocaleString('en-IN')} — an e-way bill number is required`);
  }

  // Every HSN on the order, de-duplicated — the docs allow several.
  const hsn = Array.from(new Set(input.lines.map((l) => (l.hsn ?? '').trim()).filter(Boolean))).join(',');

  const shipment: Record<string, unknown> = {
    name: cleanForDelhivery(input.to.name),
    add: cleanForDelhivery(input.to.address),
    city: cleanForDelhivery(input.to.city),
    state: cleanForDelhivery(input.to.state),
    country: 'India',
    pin: input.to.pincode,
    phone: input.to.phone,
    order: input.orderNumber,
    order_date: input.orderDate.toISOString(),
    payment_mode: 'Prepaid', // owner's decision: no COD anywhere
    cod_amount: 0,
    total_amount: input.declaredValue,
    weight: grams,
    quantity: input.lines.reduce((s, l) => s + l.units, 0),
    products_desc: cleanForDelhivery(input.lines.map((l) => `${l.name} x${l.units}`).join(', ')).slice(0, 250),
    hsn_code: hsn || undefined,
    seller_gst_tin: input.sellerGstin || undefined,
    consignee_gst_tin: input.consigneeGstin || undefined,
    invoice_reference: input.invoiceNumber || undefined,
    ewbn: input.ewaybill?.trim() || undefined,
    fragile_shipment: input.fragile ? 'true' : undefined,
    shipping_mode: 'Surface',
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
    const why = pkgRes?.remarks?.join?.(' | ') || r?.rmk || 'Delhivery rejected the shipment';
    const err = new DelhiveryError(String(why));
    (err as DelhiveryError & { raw?: unknown }).raw = r;
    throw err;
  }
  return {
    courierOrderId: String(pkgRes.refnum ?? input.orderNumber),
    shipmentRef: null,
    awb: pkgRes.waybill ? String(pkgRes.waybill) : null,
    courierName: 'Delhivery',
    raw: { request: payload, response: r },
  };
}

/** IST calendar date and clock for a moment, as Delhivery's pickup API wants
 *  them. toISOString() would give UTC — a 10:00 IST pickup booked as 04:30. */
function istParts(when: Date): { date: string; time: string } {
  const ist = new Date(when.getTime() + 330 * 60_000);
  const iso = ist.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
}

export async function delhiveryPickup(
  pickupLocation: string,
  when: Date,
  packageCount: number,
): Promise<{ pickupId: string | null; raw: unknown }> {
  const { date, time } = istParts(when);
  const body = {
    pickup_location: pickupLocation,
    pickup_date: date,
    pickup_time: time,
    expected_package_count: packageCount,
  };
  const r = await call<any>('/fm/request/new/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const id = r?.pickup_id ?? r?.data?.pickup_id ?? null;
  if (!id && (r?.success === false || r?.error || r?.pr_exist)) {
    // pr_exist: a pickup is already open for this location and day.
    const msg = r?.pr_exist
      ? 'A pickup is already scheduled for this location — Delhivery allows a new one only after it is completed'
      : readError(200, JSON.stringify(r));
    throw new DelhiveryError(msg);
  }
  return { pickupId: id ? String(id) : null, raw: r };
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
  if (!s) throw new DelhiveryError(r?.Error ? String(r.Error) : `No tracking data for ${awb}`);
  const st = s.Status ?? {};
  const scans = Array.isArray(s.Scans) ? s.Scans : [];
  return {
    awb,
    currentStatus: String(st.Status ?? ''),
    mapped: mapDelhiveryStatus(st.Status, st.StatusType, s.ReverseInTransit),
    events: scans.map((sc: any) => {
      const d = sc?.ScanDetail ?? {};
      return {
        status: String(d.Scan ?? ''),
        mapped: mapDelhiveryStatus(d.Scan, d.ScanType),
        detail: d.Instructions ?? null,
        location: d.ScannedLocation ?? null,
        occurredAt: delhiveryTime(d.ScanDateTime ?? d.StatusDateTime) ?? new Date(),
        raw: sc,
      };
    }),
    raw: r,
  };
}

export async function delhiveryCancel(awb: string): Promise<unknown> {
  const r = await call<any>('/api/p/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ waybill: awb, cancellation: 'true' }),
  });
  if (r?.status === false || r?.error) throw new DelhiveryError(readError(200, JSON.stringify(r)));
  return r;
}
