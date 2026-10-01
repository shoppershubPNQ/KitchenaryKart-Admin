/**
 * Shiprocket. Shaped like lib/integrations/razorpay.ts: plain fetch, no SDK,
 * `[shiprocket]`-prefixed logs, and the courier's OWN error text surfaced to
 * the admin instead of a generic 500 — a booking usually fails for a reason
 * only Shiprocket can state ("pickup location not found", "pincode not
 * serviceable"), and hiding it makes the failure unfixable.
 *
 * Docs: https://apidocs.shiprocket.in/ (Postman collection 8407119/SzYW1zB2),
 * checked 2026-10-01. Things they say that this file depends on:
 *  - Login needs a separate API USER (Settings → API), whose email differs
 *    from the panel login. The panel login answers "Invalid email and
 *    password combination". Repeated failures lock the account 30 min – 2 h.
 *  - There is NO sandbox: every create / assign call is a real booking.
 *  - Many failures come back as HTTP 200 with a flag in the body
 *    (awb_assign_status 0 for a low wallet, label_created 0, track_status 0),
 *    so every call checks the body, not just the status.
 *  - Times are IST with no zone.
 */
import {
  getCreds, getCachedToken, setCachedToken, setVerified, loginPausedReason, clearLoginFailure, LOGIN_FAILED_PREFIX,
  type ShiprocketCreds,
} from '../integration-credentials';
import type {
  Address, PackageSpec, QuoteOption, CreateShipmentInput,
  CreateShipmentResult, TrackResult,
} from '../shipping-providers';
import { chargeableGrams, mapShiprocketStatus, shiprocketTime } from '../shipping-providers';

const BASE = 'https://apiv2.shiprocket.in/v1/external';
/** Documented as 240 h; we keep 9 days and refresh an hour early (see
 *  getCachedToken), so a token can never expire mid-request. */
const TOKEN_TTL_MS = 9 * 24 * 60 * 60 * 1000;
/** Every call gives up after this. The booking route has 60 s in total; a
 *  hung request must fail INSIDE it so the rollback (cancel the Shiprocket
 *  order, record the failure) always runs. */
const TIMEOUT_MS = 15_000;

export class ShiprocketError extends Error {}
/** The account cannot log in (wrong API user, locked, or paused after a
 *  failure). Every later call in the same run would fail the same way. */
export class ShiprocketAuthError extends ShiprocketError {
  constructor(message: string, readonly paused = false) {
    super(message);
  }
}

function timed(): { signal: AbortSignal } {
  return { signal: AbortSignal.timeout(TIMEOUT_MS) };
}

/** fetch, with a timeout turned into a readable courier error. */
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, ...timed() });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new ShiprocketError(`Shiprocket did not answer within ${TIMEOUT_MS / 1000} s — timed out`);
    }
    throw new ShiprocketError(`Could not reach Shiprocket: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Pull the human-readable reason out of whatever shape Shiprocket returned:
 *  errors arrive as `message`, as `errors: {field: [msg]}`, or as plain text. */
function readError(status: number, body: string): string {
  try {
    const j = JSON.parse(body);
    if (j?.errors && typeof j.errors === 'object') {
      const parts = Object.entries(j.errors).map(
        ([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`,
      );
      if (parts.length) return `${typeof j?.message === 'string' ? `${j.message} — ` : ''}${parts.join(' | ')}`;
    }
    if (typeof j?.message === 'string' && j.message.trim()) return j.message;
    if (typeof j?.error === 'string' && j.error.trim()) return j.error;
  } catch {
    /* fall through to raw text */
  }
  return `Shiprocket ${status}: ${body.slice(0, 300)}`;
}

/** Some endpoints answer 2xx with an empty body (204) or plain text. */
function parseBody(text: string): any {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function login(creds: ShiprocketCreds): Promise<string> {
  // After a failed login, do not try again for a while: each attempt can
  // extend Shiprocket's lock. Saving the credentials lifts this.
  const paused = await loginPausedReason('shiprocket');
  if (paused) throw new ShiprocketAuthError(paused, true);

  const fail = async (msg: string): Promise<never> => {
    const shown = /invalid email and password/i.test(msg)
      ? `${msg}. Shiprocket's API needs a separate API user (Settings → API), not the panel login.`
      : msg;
    // Recorded on the Integrations row (marked as a LOGIN failure), so the
    // next person sees why and automatic retries pause.
    await setVerified('shiprocket', `${LOGIN_FAILED_PREFIX}${shown}`.slice(0, 500)).catch(() => undefined);
    throw new ShiprocketAuthError(shown);
  };

  let res: Response;
  try {
    res = await send(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: creds.email, password: creds.password }),
    });
  } catch (e) {
    // Not answering is not a wrong password: a plain courier error, so it is
    // not stored as a login failure and does not pause logins.
    throw e instanceof ShiprocketError ? e : new ShiprocketError(String(e));
  }
  const text = await res.text();
  // Only a 4xx JSON answer is about the credentials (wrong user, inactive,
  // locked, missing field). A 5xx, a gateway HTML page or a 2xx without a
  // token is Shiprocket being unwell: report it, but do not pause logins or
  // tell anyone to fix the API user.
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) {
    console.error('[shiprocket] login failed:', res.status, text.slice(0, 300));
    if (res.status >= 400 && res.status < 500 && json) return fail(readError(res.status, text));
    throw new ShiprocketError(`Shiprocket login unavailable (HTTP ${res.status}) — try again shortly`);
  }
  const tok = json?.token;
  if (!tok) throw new ShiprocketError('Shiprocket login unavailable (no token returned) — try again shortly');
  await setCachedToken('shiprocket', tok, new Date(Date.now() + TOKEN_TTL_MS));
  await clearLoginFailure('shiprocket').catch(() => undefined);
  return tok;
}

async function creds(): Promise<ShiprocketCreds> {
  const c = await getCreds<ShiprocketCreds>('shiprocket');
  if (!c) throw new ShiprocketError('Shiprocket is not configured');
  return c;
}

async function token(): Promise<string> {
  return (await getCachedToken('shiprocket')) ?? (await login(await creds()));
}

async function call<T>(path: string, init: RequestInit = {}, retryOn401 = true): Promise<T> {
  const t = await token();
  const res = await send(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${t}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  // A cached token can be revoked or blacklisted at Shiprocket's end. Force
  // ONE fresh login rather than failing a booking the operator is watching.
  if (res.status === 401 && retryOn401) {
    await login(await creds());
    return call<T>(path, init, false);
  }
  if (!res.ok) {
    console.error('[shiprocket]', path, 'failed:', res.status, text);
    throw new ShiprocketError(readError(res.status, text));
  }
  return parseBody(text) as T;
}

/** "YYYY-MM-DD HH:mm" in IST — what order_date expects; toISOString is UTC. */
function istStamp(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60_000).toISOString();
  return `${ist.slice(0, 10)} ${ist.slice(11, 16)}`;
}

/**
 * Real authenticated call for the Test-connection button.
 *
 * Uses a CACHED token when one is still valid. It originally forced a fresh
 * login every time so a stale cache could not fake a pass — but that made
 * every click a login attempt, and Shiprocket locks an account after a few
 * failures ("Too many failed login attempts"). A valid cached token is proof
 * enough that the account works; a wrong password never produces one.
 *
 * Also checks the saved pickup location against the account's own list: an
 * order with a nickname Shiprocket does not know is rejected at booking time,
 * which is the worst moment to find out.
 */
export async function testShiprocket(): Promise<{ ok: true; detail: string }> {
  const c = await creds();
  if (!(await getCachedToken('shiprocket'))) await login(c);
  const r = await call<any>('/settings/company/pickup');
  const list = r?.data?.shipping_address ?? [];
  const names: string[] = list.map((a: any) => String(a.pickup_location ?? '')).filter(Boolean);
  if (!names.length) throw new ShiprocketError('Connected, but this Shiprocket account has no pickup location set up yet');
  const want = (c.pickupLocation ?? '').trim();
  if (!want) throw new ShiprocketError(`Connected. Now type one of these as the pickup location name: ${names.join(', ')}`);
  if (!names.includes(want)) {
    throw new ShiprocketError(`Connected, but pickup location "${want}" is not in this account. Use exactly one of: ${names.join(', ')}`);
  }
  return { ok: true, detail: `Connected. Pickup location "${want}" found (all: ${names.join(', ')})` };
}

/**
 * Courier options and prices. Read-only — nothing is booked.
 *
 * The docs never say whether `rate` includes GST, so the UI calls it an
 * estimate. Blocked couriers are dropped. An unserviceable pincode has no
 * documented shape (empty list, body status 404, or a 400 "No Courier
 * serviceable…"), so all three become an empty list.
 */
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

  let r: any;
  try {
    r = await call<any>(`/courier/serviceability/?${q}`);
  } catch (e) {
    if (e instanceof ShiprocketError && /serviceable|no courier/i.test(e.message)) return [];
    throw e;
  }
  if (r?.status != null && Number(r.status) !== 200) {
    if (/serviceable|no courier/i.test(String(r?.message ?? ''))) return [];
    throw new ShiprocketError(String(r?.message ?? `Shiprocket answered status ${r.status}`));
  }
  const data = r?.data ?? {};
  const blocked = new Set((data.blocked_courier_companies ?? []).map((b: any) => String(b.courier_company_id)));
  const recommended = data.recommended_courier_company_id != null ? String(data.recommended_courier_company_id) : null;
  const couriers = (data.available_courier_companies ?? []).filter(
    (c: any) => c?.courier_company_id != null && !blocked.has(String(c.courier_company_id)) && !(Number(c.blocked) > 0),
  );
  return couriers.map((c: any) => {
    const id = String(c.courier_company_id);
    const days = Number(c.estimated_delivery_days);
    return {
      provider: 'shiprocket' as const,
      courierId: id,
      courierName: String(c.courier_name ?? 'Unknown'),
      charge: Number(c.rate ?? c.freight_charge ?? 0),
      etaDays: Number.isFinite(days) && days > 0 ? days : null,
      chargeableWeightGrams: grams,
      rating: c.rating != null && Number.isFinite(Number(c.rating)) ? Number(c.rating) : null,
      serviceable: true,
      note: [c.is_surface ? 'Surface' : 'Air', id === recommended ? 'Shiprocket recommends' : null].filter(Boolean).join(' · '),
    };
  });
}

/**
 * Step 1 of a booking: the Shiprocket ORDER. No AWB yet and no money moves.
 * Returns Shiprocket's own numeric order id + shipment id — every later call
 * (assign, pickup, label, cancel) takes those, never our order number.
 */
export async function shiprocketCreate(input: CreateShipmentInput): Promise<CreateShipmentResult> {
  const c = await creds();
  const pickup = (input.pickupLocation ?? c.pickupLocation ?? '').trim();
  // Never guess a nickname ("Primary"): an unknown one is rejected, and a
  // wrong-but-real one would send the courier to the wrong address.
  if (!pickup) throw new ShiprocketError('Set the Shiprocket pickup location name in Integrations first');

  const { lengthCm: l, breadthCm: b, heightCm: h } = input.pkg;
  if (!(l && l > 0.5 && b && b > 0.5 && h && h > 0.5)) {
    throw new ShiprocketError('Shiprocket needs the box size — enter length, breadth and height (cm)');
  }
  const email = (input.to.email ?? '').trim();
  if (!email) throw new ShiprocketError('Shiprocket needs the customer email — the order has none');
  if (input.to.address.length > 190) {
    throw new ShiprocketError(`Address is ${input.to.address.length} characters; Shiprocket accepts 190. Shorten it (drop repeats of city/state/pincode).`);
  }
  if (!input.to.state.trim()) throw new ShiprocketError('State is required for Shiprocket — press Check on the pincode, or type it');

  // sub_total must equal the sum of the lines. Shiprocket does NOT compute it.
  const subTotal = input.lines.reduce((s, line) => s + line.sellingPrice * line.units, 0);
  const grams = input.pkg.weightGrams;

  const body: Record<string, unknown> = {
    order_id: input.orderNumber,
    order_date: istStamp(input.orderDate),
    pickup_location: pickup,
    billing_customer_name: input.to.name,
    billing_last_name: '',
    billing_address: input.to.address,
    billing_city: input.to.city.slice(0, 30), // documented 30-character limit
    billing_pincode: input.to.pincode,
    billing_state: input.to.state,
    billing_country: 'India',
    billing_email: email,
    billing_phone: input.to.phone,
    shipping_is_billing: true,
    order_items: input.lines.map((line) => ({
      name: line.name.slice(0, 120),
      sku: line.sku || line.name.slice(0, 40),
      units: line.units,
      selling_price: line.sellingPrice, // per unit, GST-inclusive — as documented
      hsn: line.hsn ?? undefined,
      tax: line.taxPercent ?? undefined,
    })),
    payment_method: 'Prepaid',
    sub_total: Number(subTotal.toFixed(2)),
    length: l,
    breadth: b,
    height: h,
    weight: Number((grams / 1000).toFixed(3)), // KG
    customer_gstin: input.consigneeGstin || undefined,
    invoice_number: input.invoiceNumber || undefined,
    ewaybill_no: input.ewaybill?.trim() || undefined,
  };
  if (c.channelId) body.channel_id = c.channelId;

  const r = await call<any>('/orders/create/adhoc', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  // A 2xx without an order id is a failure with its reason in the body.
  if (!r?.order_id) throw new ShiprocketError(readError(200, JSON.stringify(r)));
  return {
    courierOrderId: String(r.order_id),
    shipmentRef: r.shipment_id != null ? String(r.shipment_id) : null,
    awb: r.awb_code || null,
    courierName: r.courier_name ?? null,
    raw: { request: body, response: r },
  };
}

/**
 * Step 2: the AWB from the chosen courier. THIS DEBITS THE SHIPROCKET WALLET.
 * Success is awb_assign_status 1 with an AWB; a low wallet is HTTP 200 with
 * awb_assign_status 0 and a "Please recharge…" message.
 */
export async function shiprocketAssignAwb(
  shipmentRef: string,
  courierId?: string | null,
): Promise<{ awb: string; courierName: string | null; charge: number | null; pickupScheduledAt: Date | null; raw: unknown }> {
  const body: Record<string, unknown> = { shipment_id: Number(shipmentRef), is_return: 0 };
  if (courierId) body.courier_id = Number(courierId);
  const r = await call<any>('/courier/assign/awb', { method: 'POST', body: JSON.stringify(body) });
  const d = r?.response?.data ?? {};
  const awb = d.awb_code ? String(d.awb_code) : '';
  if (Number(r?.awb_assign_status) !== 1 || !awb) {
    const why = d.awb_assign_error || r?.message || r?.response?.message || 'Shiprocket did not assign an AWB';
    const err = new ShiprocketError(String(why));
    (err as ShiprocketError & { raw?: unknown }).raw = r;
    throw err;
  }
  const charge = Number(d.freight_charges);
  return {
    awb,
    courierName: d.courier_name ?? null,
    // Not documented as reliably filled; null rather than a guess.
    charge: Number.isFinite(charge) && charge > 0 ? charge : null,
    // Auto-pickup couriers are queued for pickup at assignment.
    pickupScheduledAt: shiprocketTime(d.pickup_scheduled_date),
    raw: r,
  };
}

/**
 * Ask the courier to collect. One shipment per call (the docs disagree on
 * more). pickup_date is an IST date; Sunday/holiday rolls to the next day.
 * A shipment already queued needs status "retry".
 */
export async function shiprocketPickup(
  shipmentRef: string,
  when: Date,
  retry = false,
): Promise<{ pickupId: string | null; scheduledFor: Date | null }> {
  const istDate = new Date(when.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const body: Record<string, unknown> = { shipment_id: [Number(shipmentRef)], pickup_date: [istDate] };
  if (retry) body.status = 'retry';
  const r = await call<any>('/courier/generate/pickup', { method: 'POST', body: JSON.stringify(body) });
  if (Number(r?.pickup_status) !== 1) {
    throw new ShiprocketError(String(r?.response?.data ?? r?.message ?? 'Shiprocket did not confirm the pickup'));
  }
  const resp = r.response ?? {};
  return {
    pickupId: resp.pickup_token_number ? String(resp.pickup_token_number).replace(/^Reference No:\s*/i, '') : null,
    scheduledFor: shiprocketTime(resp.pickup_scheduled_date),
  };
}

/** Label PDF. Failures are HTTP 200 with label_created 0 and the reason in
 *  `response` (e.g. "Please schedule Pickup to generate labels."). */
export async function shiprocketLabel(shipmentRef: string): Promise<string> {
  const r = await call<any>('/courier/generate/label', {
    method: 'POST',
    body: JSON.stringify({ shipment_id: [Number(shipmentRef)] }),
  });
  if (Number(r?.label_created) !== 1 || !r?.label_url) {
    throw new ShiprocketError(String(r?.response ?? r?.message ?? 'Shiprocket did not return a label'));
  }
  return String(r.label_url);
}

/**
 * Scans for one AWB. "No tracking yet" is HTTP 200 with track_status 0 —
 * returned as no events, not an error, so a freshly booked AWB polls quietly.
 * Status comes from the NUMERIC shipment code (see mapShiprocketStatus).
 */
export async function shiprocketTrack(awb: string): Promise<TrackResult> {
  const r = await call<any>(`/courier/track/awb/${encodeURIComponent(awb)}`);
  const td = r?.tracking_data ?? {};
  if (Number(td.track_status) === 0) {
    return { awb, currentStatus: String(td.error ?? 'No tracking yet'), mapped: null, events: [], raw: r };
  }
  const activities: any[] = Array.isArray(td.shipment_track_activities) ? td.shipment_track_activities : [];
  const current = td?.shipment_track?.[0]?.current_status ?? '';
  return {
    awb,
    currentStatus: String(current),
    mapped: mapShiprocketStatus(td.shipment_status, current),
    events: activities.map((a: any) => {
      const label = a['sr-status-label'] && a['sr-status-label'] !== 'NA' ? String(a['sr-status-label']) : '';
      return {
        status: (label || String(a.status ?? a.activity ?? '')).slice(0, 120),
        mapped: mapShiprocketStatus(a['sr-status'], label),
        detail: a.activity ?? null,
        location: a.location ?? null,
        occurredAt: shiprocketTime(a.date) ?? new Date(),
        raw: a,
      };
    }),
    raw: r,
  };
}

/**
 * Cancel the AWB (before "Out for Pickup"). The freight returns to the wallet
 * within about a day — faster than an order cancel. Success is HTTP 200/204,
 * often with an "in progress" message (accepted, not yet done); refusals ALSO
 * come back as 200 with a message, so the words are checked. "Shipment(s) are
 * in processing tab" means the AWB is already released (the order is back in
 * Processing, where only the order can be cancelled) — not a refusal.
 */
export async function shiprocketCancelAwb(awb: string): Promise<{ alreadyReleased: boolean; raw: unknown }> {
  const r = await call<any>('/orders/cancel/shipment/awbs', {
    method: 'POST',
    body: JSON.stringify({ awbs: [awb] }),
  });
  const msg = String(r?.error_msg ?? r?.message ?? '');
  if (/processing tab/i.test(msg)) return { alreadyReleased: true, raw: r };
  if (Number(r?.status) === 400 || /cannot|can not|could not|not allowed|invalid/i.test(msg)) {
    throw new ShiprocketError(msg || 'Shiprocket refused to cancel this AWB');
  }
  return { alreadyReleased: false, raw: r };
}

/** Cancel the Shiprocket ORDER (ids are Shiprocket's numeric order ids, never
 *  ours). Sends ONLY ids: other filters on this endpoint cancel in bulk. */
export async function shiprocketCancelOrder(courierOrderId: string): Promise<unknown> {
  const id = Number(courierOrderId);
  if (!Number.isFinite(id) || id <= 0) throw new ShiprocketError(`Not a Shiprocket order id: ${courierOrderId}`);
  const r = await call<any>('/orders/cancel', {
    method: 'POST',
    body: JSON.stringify({ ids: [id] }),
  });
  if (/cannot|can not|invalid|requested for rto/i.test(String(r?.message ?? ''))) {
    throw new ShiprocketError(String(r.message));
  }
  return r;
}
