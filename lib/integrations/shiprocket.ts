/**
 * Shiprocket. Shaped like lib/integrations/razorpay.ts: plain fetch, no SDK,
 * `[shiprocket]`-prefixed logs, and the courier's OWN error text surfaced to
 * the admin instead of a generic 500 — a booking usually fails for a reason
 * only Shiprocket can state ("pickup location not found", "pincode not
 * serviceable"), and hiding it makes the failure unfixable.
 *
 * Docs: https://apidocs.shiprocket.in/
 */
import {
  getCreds, getCachedToken, setCachedToken,
  type ShiprocketCreds,
} from '../integration-credentials';
import type {
  Address, PackageSpec, QuoteOption, CreateShipmentInput,
  CreateShipmentResult, TrackResult,
} from '../shipping-providers';
import { mapCourierStatus, chargeableGrams } from '../shipping-providers';

const BASE = 'https://apiv2.shiprocket.in/v1/external';
/** Documented as 240 h; we keep 9 days and refresh an hour early (see
 *  getCachedToken), so a token can never expire mid-request. */
const TOKEN_TTL_MS = 9 * 24 * 60 * 60 * 1000;

export class ShiprocketError extends Error {}

/** Pull the human-readable reason out of whatever shape Shiprocket returned:
 *  errors arrive either as `message` or as `errors: {field: [msg]}`. */
function readError(status: number, body: string): string {
  try {
    const j = JSON.parse(body);
    if (typeof j?.message === 'string' && j.message.trim()) return j.message;
    if (j?.errors && typeof j.errors === 'object') {
      const parts = Object.entries(j.errors).map(
        ([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`,
      );
      if (parts.length) return parts.join(' | ');
    }
  } catch {
    /* fall through to raw text */
  }
  return `Shiprocket ${status}: ${body.slice(0, 300)}`;
}

async function login(creds: ShiprocketCreds): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('[shiprocket] login failed:', res.status, text);
    throw new ShiprocketError(readError(res.status, text));
  }
  const tok = JSON.parse(text)?.token;
  if (!tok) throw new ShiprocketError('Shiprocket returned no token');
  await setCachedToken('shiprocket', tok, new Date(Date.now() + TOKEN_TTL_MS));
  return tok;
}

async function token(): Promise<string> {
  const creds = await getCreds<ShiprocketCreds>('shiprocket');
  if (!creds) throw new ShiprocketError('Shiprocket is not configured');
  return (await getCachedToken('shiprocket')) ?? (await login(creds));
}

async function call<T>(path: string, init: RequestInit = {}, retryOn401 = true): Promise<T> {
  const t = await token();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${t}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  // A cached token can be revoked at Shiprocket's end. Force one fresh login
  // rather than failing a booking the operator is watching.
  if (res.status === 401 && retryOn401) {
    const creds = await getCreds<ShiprocketCreds>('shiprocket');
    if (creds) {
      await login(creds);
      return call<T>(path, init, false);
    }
  }
  if (!res.ok) {
    console.error('[shiprocket]', path, 'failed:', res.status, text);
    throw new ShiprocketError(readError(res.status, text));
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** Real authenticated call for the Test-connection button. Logging in alone
 *  proves the password but not that the account is usable. */
export async function testShiprocket(): Promise<{ ok: true; detail: string }> {
  const creds = await getCreds<ShiprocketCreds>('shiprocket');
  if (!creds) throw new ShiprocketError('Shiprocket is not configured');
  await login(creds); // always fresh, so a stale cache cannot fake a pass
  const r = await call<any>('/settings/company/pickup');
  const list = r?.data?.shipping_address ?? [];
  const names = list.map((a: any) => a.pickup_location).filter(Boolean);
  return {
    ok: true,
    detail: names.length
      ? `Connected. Pickup locations: ${names.join(', ')}`
      : 'Connected, but this account has no pickup location set up yet',
  };
}

export async function shiprocketQuote(
  fromPincode: string,
  to: Address,
  pkg: PackageSpec,
  declaredValue: number,
): Promise<QuoteOption[]> {
  const grams = chargeableGrams(pkg);
  const q = new URLSearchParams({
    pickup_postcode: fromPincode,
    delivery_postcode: to.pincode,
    cod: '0', // prepaid only — owner's decision
    weight: (grams / 1000).toFixed(3), // Shiprocket expects KG
    declared_value: String(Math.round(declaredValue)),
  });
  if (pkg.lengthCm) q.set('length', String(pkg.lengthCm));
  if (pkg.breadthCm) q.set('breadth', String(pkg.breadthCm));
  if (pkg.heightCm) q.set('height', String(pkg.heightCm));

  const r = await call<any>(`/courier/serviceability/?${q}`);
  const couriers = r?.data?.available_courier_companies ?? [];
  return couriers.map((c: any) => ({
    provider: 'shiprocket' as const,
    courierId: String(c.courier_company_id),
    courierName: c.courier_name ?? 'Unknown',
    charge: Number(c.rate ?? 0),
    etaDays: c.estimated_delivery_days ? Number(c.estimated_delivery_days) : null,
    chargeableWeightGrams: grams,
    rating: c.rating != null ? Number(c.rating) : null,
    serviceable: true,
    note: c.is_surface ? 'Surface' : 'Air',
  }));
}

export async function shiprocketCreate(input: CreateShipmentInput): Promise<CreateShipmentResult> {
  const creds = await getCreds<ShiprocketCreds>('shiprocket');
  if (!creds) throw new ShiprocketError('Shiprocket is not configured');

  // sub_total must equal the sum of the lines. Shiprocket does NOT compute it,
  // and a mismatch is one of the commonest silent rejections.
  const subTotal = input.lines.reduce((s, l) => s + l.sellingPrice * l.units, 0);
  const grams = input.pkg.weightGrams;

  const body: Record<string, unknown> = {
    order_id: input.orderNumber,
    order_date: input.orderDate.toISOString().slice(0, 19).replace('T', ' '),
    pickup_location: input.pickupLocation ?? creds.pickupLocation ?? 'Primary',
    billing_customer_name: input.to.name,
    billing_last_name: '',
    billing_address: input.to.address,
    billing_city: input.to.city,
    billing_pincode: input.to.pincode,
    billing_state: input.to.state,
    billing_country: 'India',
    billing_email: input.to.email ?? '',
    billing_phone: input.to.phone,
    shipping_is_billing: true,
    order_items: input.lines.map((l) => ({
      name: l.name.slice(0, 120),
      sku: l.sku,
      units: l.units,
      selling_price: l.sellingPrice,
      hsn: l.hsn ?? undefined,
    })),
    payment_method: 'Prepaid',
    sub_total: Number(subTotal.toFixed(2)),
    length: input.pkg.lengthCm ?? undefined,
    breadth: input.pkg.breadthCm ?? undefined,
    height: input.pkg.heightCm ?? undefined,
    weight: Number((grams / 1000).toFixed(3)), // KG
  };
  if (creds.channelId) body.channel_id = creds.channelId;

  const r = await call<any>('/orders/create/adhoc', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!r?.order_id) throw new ShiprocketError(r?.message ?? 'Shiprocket did not return an order id');
  return {
    courierOrderId: String(r.order_id),
    shipmentRef: r.shipment_id != null ? String(r.shipment_id) : null,
    awb: r.awb_code ?? null,
    courierName: r.courier_name ?? null,
    raw: r,
  };
}

export async function shiprocketAssignAwb(
  shipmentRef: string,
  courierId?: string | null,
): Promise<{ awb: string; courierName: string | null; charge: number | null; raw: unknown }> {
  const body: Record<string, unknown> = { shipment_id: Number(shipmentRef) };
  if (courierId) body.courier_id = Number(courierId);
  const r = await call<any>('/courier/assign/awb', { method: 'POST', body: JSON.stringify(body) });
  const d = r?.response?.data ?? r?.data ?? {};
  const awb = d.awb_code ?? r?.awb_code;
  if (!awb) throw new ShiprocketError(r?.message ?? 'Shiprocket did not return an AWB');
  return {
    awb: String(awb),
    courierName: d.courier_name ?? null,
    charge: d.freight_charges != null ? Number(d.freight_charges) : null,
    raw: r,
  };
}

export async function shiprocketPickup(shipmentRef: string): Promise<unknown> {
  return call<any>('/courier/generate/pickup', {
    method: 'POST',
    body: JSON.stringify({ shipment_id: [Number(shipmentRef)] }),
  });
}

export async function shiprocketLabel(shipmentRef: string): Promise<string> {
  const r = await call<any>('/courier/generate/label', {
    method: 'POST',
    body: JSON.stringify({ shipment_id: [Number(shipmentRef)] }),
  });
  const url = r?.label_url;
  if (!url) throw new ShiprocketError(r?.message ?? 'Shiprocket did not return a label');
  return String(url);
}

export async function shiprocketTrack(awb: string): Promise<TrackResult> {
  const r = await call<any>(`/courier/track/awb/${encodeURIComponent(awb)}`);
  const td = r?.tracking_data ?? {};
  const activities = td?.shipment_track_activities ?? [];
  const current = td?.shipment_track?.[0]?.current_status ?? td?.track_status ?? '';
  return {
    awb,
    currentStatus: String(current),
    mapped: mapCourierStatus(current),
    events: activities.map((a: any) => {
      const label = a.status ?? a['sr-status-label'] ?? '';
      return {
        status: String(label),
        mapped: mapCourierStatus(label),
        detail: a.activity ?? null,
        location: a.location ?? null,
        occurredAt: a.date ? new Date(a.date) : new Date(),
        raw: a,
      };
    }),
    raw: r,
  };
}

export async function shiprocketCancel(courierOrderId: string): Promise<unknown> {
  return call<any>('/orders/cancel', {
    method: 'POST',
    body: JSON.stringify({ ids: [Number(courierOrderId)] }),
  });
}
