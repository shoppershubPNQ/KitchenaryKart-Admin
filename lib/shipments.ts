/**
 * Booking and following a courier shipment for an order — Delhivery or
 * Shiprocket.
 *
 * The admin order page, the hourly poll and the courier webhook all come
 * through here, so a scan has the same effect whichever way it arrives:
 *
 *   quoteForOrder   → serviceability + rate estimate (no money moves)
 *   bookShipment    → AWB from the courier (THIS debits the courier wallet)
 *   shipmentLabel / schedulePickup / cancelShipment / refreshShipment
 *   applyCourierUpdate → record scans, move shipment + order forward only
 *
 * Booking is only ever a person clicking a button. Nothing here books on its
 * own: every booking costs money.
 *
 * Shiprocket books in two steps — an order, then an AWB from the courier the
 * operator picked off the rate list. The order is stored on the shipment the
 * moment it exists, so an AWB step that fails leaves nothing behind unseen:
 * the Shiprocket order is cancelled, or — when even that fails — the row is
 * kept open with the reason, so nobody re-books on top of a possibly paid AWB.
 */
import type { OrderStatus, Shipment, ShipmentProvider, ShipmentStatus } from '@prisma/client';
import { prisma } from './db';
import { applyOrderStatus } from './order-status';
import { parseGrams } from './shipping-zones';
import { formatInvoiceNumber } from './invoice-serial';
import { getCreds, type ShiprocketCreds } from './integration-credentials';
import {
  type Address, type PackageSpec, type QuoteOption, type TrackResult, type ShipmentLine,
  orderStatusFor, trackingUrlFor, isForwardMove,
} from './shipping-providers';
import {
  delhiveryCreds, delhiveryQuote, delhiveryCreate, delhiveryLabel,
  delhiveryPickup, delhiveryCancel, delhiveryTrack, delhiveryServiceable,
  DelhiveryError, EWAYBILL_THRESHOLD,
} from './integrations/delhivery';
import {
  shiprocketQuote, shiprocketCreate, shiprocketAssignAwb, shiprocketLabel,
  shiprocketPickup, shiprocketTrack, shiprocketCancelAwb, shiprocketCancelOrder,
  ShiprocketError, ShiprocketAuthError,
} from './integrations/shiprocket';

export class ShipmentError extends Error {}

/** The Shiprocket order behind a failed AWB step could NOT be cancelled, so an
 *  AWB may exist and may be paid for. The row stays open (blocking a second
 *  booking) until a person cancels it from the order page. */
class UnresolvedBookingError extends ShipmentError {}

/** Company address pincode — the fallback origin when Integrations has none. */
const DEFAULT_ORIGIN_PINCODE = '411048';

/** Shipments in these states are finished: no booking is "active", no poll. */
const TERMINAL: ShipmentStatus[] = ['delivered', 'rto', 'cancelled', 'failed'];

/** A draft younger than this still counts as a booking in progress: longer
 *  than the route's 60 s limit, so a request that was killed mid-booking
 *  stops blocking the order a minute after it died. */
const DRAFT_IN_PROGRESS_MS = 2 * 60_000;

/** Shiprocket cancels asynchronously ("in progress, wait 24 hours"), so a
 *  cancelled Shiprocket shipment keeps being polled this long to catch a
 *  cancel that did not take. */
const CANCEL_WATCH_MS = 5 * 24 * 60 * 60_000;

export const PROVIDER_NAME: Record<ShipmentProvider, string> = {
  delhivery: 'Delhivery',
  shiprocket: 'Shiprocket',
};

/** A courier's own refusal, shown to the operator as-is. */
function isCourierError(e: unknown): e is Error {
  return e instanceof DelhiveryError || e instanceof ShiprocketError;
}

const today = () => new Date().toISOString().slice(0, 10);

// ─── Address ─────────────────────────────────────────────────────────────

/**
 * Split the checkout's address blob into what a courier needs. The blob is
 *   "Name · +91 98xxxxxxxx\nline, line, City, State, 411048"
 * (checkout joins with ", "). Best effort ONLY — the operator confirms every
 * field before booking, and a pincode check fills the state from Delhivery.
 * Real data has a missing state ("…Panjim, 403006") and doubled commas.
 */
export function parseShippingAddress(blob: string | null | undefined, fallback: { name?: string | null; phone?: string | null } = {}): Address {
  const text = String(blob ?? '').trim();
  const [head = '', ...rest] = text.split('\n');
  let name = fallback.name ?? '';
  let phone = fallback.phone ?? '';
  let body = rest.join(', ');
  if (head.includes('·')) {
    const [n, p] = head.split('·').map((s) => s.trim());
    name = n || name;
    phone = p || phone;
  } else if (!rest.length) {
    body = head;
  } else {
    body = [head, ...rest].join(', ');
  }
  const parts = body.split(',').map((s) => s.trim()).filter(Boolean);
  let pincode = '';
  const pinIdx = parts.findIndex((p) => /^\d{6}$/.test(p.replace(/\s/g, '')));
  if (pinIdx >= 0) {
    pincode = parts[pinIdx].replace(/\s/g, '');
    parts.splice(pinIdx, 1);
  } else {
    const m = body.match(/\b(\d{6})\b/);
    if (m) pincode = m[1];
  }
  const state = parts.length >= 3 ? parts.pop()! : '';
  const city = parts.length >= 2 ? parts.pop()! : '';
  return {
    name: name.trim(),
    phone: normalisePhone(phone),
    address: parts.join(', '),
    city,
    state,
    pincode,
  };
}

/** Both couriers want a 10-digit mobile; strip +91 / 0 / spaces. */
export function normalisePhone(raw: string | null | undefined): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

// ─── Context ─────────────────────────────────────────────────────────────

async function loadOrder(orderId: number) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          product: { select: { hsnCode: true, weight: true, name: true } },
          variant: { select: { weight: true } },
        },
      },
      shipments: { orderBy: { id: 'desc' } },
    },
  });
  if (!order) throw new ShipmentError('Order not found');
  return order;
}
type LoadedOrder = Awaited<ReturnType<typeof loadOrder>>;

function activeShipment(order: LoadedOrder): Shipment | null {
  return order.shipments.find((s) => !TERMINAL.includes(s.status) && s.status !== 'draft') ?? null;
}

/** Sum of the catalogue weights, for a starting value the operator corrects.
 *  Items with no weight make the total an underestimate — reported, not hidden. */
function catalogueWeight(order: LoadedOrder): { grams: number; missing: number } {
  let grams = 0;
  let missing = 0;
  for (const it of order.items) {
    const g = parseGrams(it.variant?.weight ?? it.product?.weight ?? null);
    if (g == null) missing++;
    else grams += g * it.quantity;
  }
  return { grams, missing };
}

/** The warehouse pincode. Both couriers collect from the same warehouse; the
 *  pincode is stored on the Delhivery card, else the company address. */
async function originPincode(): Promise<string> {
  const c = await delhiveryCreds().catch(() => null);
  return c?.pickupPincode && /^\d{6}$/.test(c.pickupPincode) ? c.pickupPincode : DEFAULT_ORIGIN_PINCODE;
}

async function sellerGstin(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: 'company_gst' } });
  return (row?.value ?? '').trim() || '27AAQPR2976J1ZU';
}

async function shiprocketCreds(): Promise<ShiprocketCreds> {
  const c = await getCreds<ShiprocketCreds>('shiprocket');
  if (!c) throw new ShipmentError('Shiprocket is not configured — add the API user in Integrations');
  return c;
}

/** Which couriers can be offered on the order page, and the last error each
 *  reported (a Shiprocket login that keeps failing should be visible here,
 *  not discovered at the moment someone tries to book). */
async function providerStatus(): Promise<Record<ShipmentProvider, { configured: boolean; lastError: string | null }>> {
  const rows = await prisma.integrationCredential.findMany({ select: { provider: true, lastError: true } });
  const err = (p: ShipmentProvider) => rows.find((r) => r.provider === p)?.lastError ?? null;
  return {
    delhivery: { configured: await delhiveryCreds().then(() => true).catch(() => false), lastError: err('delhivery') },
    shiprocket: { configured: (await getCreds('shiprocket').catch(() => null)) !== null, lastError: err('shiprocket') },
  };
}

/** What the order page needs to draw the shipping panel. */
export async function shipmentPanel(orderId: number) {
  const order = await loadOrder(orderId);
  const providers = await providerStatus();
  const weight = catalogueWeight(order);
  const declaredValue = Number(order.totalAmount ?? 0);
  const shipments = await prisma.shipment.findMany({
    where: { orderId },
    orderBy: { id: 'desc' },
    include: { events: { orderBy: { occurredAt: 'desc' }, take: 30 } },
  });
  return {
    configured: providers.delhivery.configured || providers.shiprocket.configured,
    providers,
    canBook: bookingBlocker(order),
    defaults: {
      to: parseShippingAddress(order.shippingAddress, { name: order.customerName, phone: order.customerPhone }),
      weightGrams: weight.grams || null,
      itemsMissingWeight: weight.missing,
      declaredValue,
      ewaybillRequired: declaredValue > EWAYBILL_THRESHOLD,
    },
    shipments: shipments.map((s) => ({
      id: s.id,
      provider: s.provider,
      status: s.status,
      awb: s.awb,
      courierName: s.courierName,
      courierOrderId: s.courierOrderId,
      labelUrl: s.labelUrl,
      trackingUrl: s.awb ? trackingUrlFor(s.provider, s.awb) : null,
      weightGrams: s.weightGrams,
      declaredValue: s.declaredValue == null ? null : Number(s.declaredValue),
      chargedAmount: s.chargedAmount == null ? null : Number(s.chargedAmount),
      pickupScheduledAt: s.pickupScheduledAt,
      cancelledAt: s.cancelledAt,
      lastError: s.lastError,
      createdAt: s.createdAt,
      to: [s.toName, s.toAddress, s.toCity, s.toState, s.toPincode].filter(Boolean).join(', '),
      events: s.events.map((e) => ({
        status: e.status, mapped: e.mappedStatus, detail: e.statusDetail, location: e.location, at: e.occurredAt,
      })),
    })),
  };
}

/** Null when the order may be booked; otherwise the reason it may not. */
function bookingBlocker(order: LoadedOrder): string | null {
  if (order.paymentStatus !== 'completed') return 'Payment is not completed — record the payment first';
  if (order.orderStatus === 'cancelled' || order.orderStatus === 'returned') return `Order is ${order.orderStatus}`;
  if (order.orderStatus === 'delivered') return 'Order is already delivered';
  const act = activeShipment(order);
  if (act) return `Already booked with ${PROVIDER_NAME[act.provider]} — AWB ${act.awb ?? '(pending)'}. Cancel it first to re-book.`;
  if (!order.items.length) return 'Order has no items';
  return null;
}

// ─── Quote ───────────────────────────────────────────────────────────────

export interface BookingInput {
  provider: ShipmentProvider;
  to: Address;
  pkg: PackageSpec;
  /** Shiprocket only: the courier picked from the rate list. */
  courierId?: string | null;
  ewaybill?: string | null;
  fragile?: boolean;
}

function validate(input: BookingInput) {
  const { to, pkg } = input;
  if (!to.name?.trim()) throw new ShipmentError('Receiver name is required');
  if (!/^\d{10}$/.test(normalisePhone(to.phone))) throw new ShipmentError('A 10-digit mobile number is required');
  if (!to.address?.trim()) throw new ShipmentError('Address is required');
  if (!to.city?.trim()) throw new ShipmentError('City is required');
  if (!/^\d{6}$/.test(to.pincode ?? '')) throw new ShipmentError('A 6-digit pincode is required');
  if (!pkg.weightGrams || pkg.weightGrams < 50) throw new ShipmentError('Package weight (grams) is required');
  if (pkg.weightGrams > 200_000) {
    throw new ShipmentError(`Weight above 200 kg — book this as a heavy/B2B shipment in the ${PROVIDER_NAME[input.provider]} panel`);
  }
}

/** Shiprocket rejects an order without these, so they are checked before any
 *  row or Shiprocket order exists. Quotes do not need them. */
function validateShiprocketBooking(input: BookingInput, customerEmail: string | null) {
  const { lengthCm: l, breadthCm: b, heightCm: h } = input.pkg;
  if (!(l && l > 0.5 && b && b > 0.5 && h && h > 0.5)) {
    throw new ShipmentError('Shiprocket needs the box size — enter length, breadth and height (cm)');
  }
  if (!customerEmail?.trim()) throw new ShipmentError('Shiprocket needs the customer email, and this order has none');
  if (!input.to.state?.trim()) throw new ShipmentError('State is required for Shiprocket — press Check on the pincode, or type it');
  if (input.to.address.length > 190) {
    throw new ShipmentError(`Address is ${input.to.address.length} characters; Shiprocket accepts 190 — shorten it`);
  }
}

export async function pincodeCheck(pincode: string) {
  return delhiveryServiceable(pincode);
}

export async function quoteForOrder(orderId: number, input: BookingInput): Promise<QuoteOption[]> {
  const order = await loadOrder(orderId);
  validate(input);
  const from = await originPincode();
  if (input.provider === 'shiprocket') {
    await shiprocketCreds();
    const list = await shiprocketQuote(from, input.to, input.pkg, Number(order.totalAmount ?? 0));
    if (!list.length) {
      return [{
        provider: 'shiprocket', courierId: '', courierName: 'Shiprocket', charge: 0, etaDays: null,
        chargeableWeightGrams: null, rating: null, serviceable: false,
        note: 'No Shiprocket courier serves this pincode for this weight',
      }];
    }
    return [...list].sort((a, b) => a.charge - b.charge);
  }
  return delhiveryQuote(from, input.to, input.pkg);
}

// ─── Book ────────────────────────────────────────────────────────────────

interface Booked {
  awb: string;
  courierName: string;
  courierOrderId: string;
  shipmentRef: string | null;
  chargedAmount: number | null;
  pickupScheduledAt: Date | null;
  rawRequest: unknown;
  rawResponse: unknown;
}

/**
 * The goods as invoiced, for Shiprocket's order_items / sub_total (Shiprocket
 * does not compute sub_total). Unit prices are GST-inclusive; a coupon
 * (Order.discountAmount, also GST-inclusive — KKMUMJQZM4: 7,290 − 729 =
 * 6,561 total) is spread over the lines pro rata, so the value Shiprocket
 * records next to our invoice number is the value on that invoice.
 */
function invoicedLines(order: LoadedOrder): ShipmentLine[] {
  const lines: ShipmentLine[] = order.items.map((it) => ({
    name: it.productName ?? it.product?.name ?? it.productSku ?? 'Item',
    sku: it.productSku ?? '',
    units: it.quantity,
    sellingPrice: Number(it.unitPrice),
    hsn: it.product?.hsnCode ?? null,
    taxPercent: Number(it.taxPercent),
  }));
  const gross = lines.reduce((s, l) => s + l.sellingPrice * l.units, 0);
  const discount = Number(order.discountAmount ?? 0);
  if (!(discount > 0) || !(gross > discount)) return lines;
  const factor = (gross - discount) / gross;
  return lines.map((l) => ({ ...l, sellingPrice: Math.round(l.sellingPrice * factor * 100) / 100 }));
}

/**
 * Take the booking slot for this order. In one transaction, with the order
 * row locked: re-check that no shipment is active and no other booking is in
 * flight, then insert the draft. Two staff booking the same order at the same
 * moment (even with different couriers) cannot both get past this — without
 * it both would pass the snapshot check and both AWBs would be paid for.
 */
async function claimDraft(orderId: number, data: Parameters<typeof prisma.shipment.create>[0]['data']) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
    const busy = await tx.shipment.findFirst({
      where: {
        orderId,
        OR: [
          { status: { notIn: [...TERMINAL, 'draft'] } },
          { status: 'draft', createdAt: { gt: new Date(Date.now() - DRAFT_IN_PROGRESS_MS) } },
        ],
      },
      select: { provider: true, status: true, awb: true },
    });
    if (busy) {
      throw new ShipmentError(
        busy.status === 'draft'
          ? `Another ${PROVIDER_NAME[busy.provider]} booking for this order is in progress — wait a minute and reload`
          : `Already booked with ${PROVIDER_NAME[busy.provider]} — AWB ${busy.awb ?? '(pending)'}. Cancel it first to re-book.`,
      );
    }
    return tx.shipment.create({ data });
  });
}

export async function bookShipment(orderId: number, input: BookingInput, adminId: number | null) {
  const order = await loadOrder(orderId);
  const blocked = bookingBlocker(order);
  if (blocked) throw new ShipmentError(blocked);
  validate(input);
  const provider = input.provider;
  const name = PROVIDER_NAME[provider];
  if (provider === 'shiprocket') {
    if (!input.courierId) throw new ShipmentError('Get rates and choose a courier first');
    validateShiprocketBooking(input, order.customerEmail);
  }

  const declaredValue = Number(order.totalAmount ?? 0);
  if (declaredValue > EWAYBILL_THRESHOLD && !input.ewaybill?.trim()) {
    throw new ShipmentError(`Order value is above ₹${EWAYBILL_THRESHOLD.toLocaleString('en-IN')} — enter the e-way bill number`);
  }

  // Both couriers need a unique order id per booking (Shiprocket never
  // accepts a cancelled order's id again). First booking uses the order
  // number as-is; a re-booking after a cancel or failure gets -2, -3…
  const previous = order.shipments.filter((s) => s.provider === provider && s.status !== 'draft').length;
  const reference = previous ? `${order.orderNumber}-${previous + 1}` : order.orderNumber;

  const to = { ...input.to, phone: normalisePhone(input.to.phone) };
  const lines = invoicedLines(order);
  const invoiceNumber = order.invoiceSerial && order.invoiceFinancialYear
    ? formatInvoiceNumber(order.invoiceFinancialYear, order.invoiceSerial)
    : null;
  const common = {
    orderNumber: reference,
    orderDate: order.createdAt,
    pkg: input.pkg,
    lines,
    declaredValue,
    paymentMode: 'Prepaid' as const,
    sellerGstin: await sellerGstin(),
    consigneeGstin: order.customerGstin,
    ewaybill: input.ewaybill ?? null,
    fragile: !!input.fragile,
    invoiceNumber,
  };

  // Fail on missing credentials BEFORE a draft row exists.
  const dCreds = provider === 'delhivery' ? await delhiveryCreds() : null;
  const sCreds = provider === 'shiprocket' ? await shiprocketCreds() : null;

  const draft = await claimDraft(orderId, {
    orderId,
    provider,
    status: 'draft',
    courierOrderId: reference,
    toName: to.name, toPhone: to.phone, toAddress: to.address,
    toCity: to.city, toState: to.state, toPincode: to.pincode,
    weightGrams: Math.round(input.pkg.weightGrams),
    lengthCm: input.pkg.lengthCm ?? null,
    breadthCm: input.pkg.breadthCm ?? null,
    heightCm: input.pkg.heightCm ?? null,
    declaredValue,
    createdById: adminId,
  });

  // Set once the courier has sold us an AWB. From then on a failure must
  // never mark the row "failed": the AWB is paid for and must stay visible
  // and cancellable, or someone re-books and pays twice.
  let booked: Booked | undefined;
  try {
    if (provider === 'delhivery') {
      const res = await delhiveryCreate({ ...common, to, pickupLocation: dCreds!.pickupLocation || dCreds!.clientName });
      if (!res.awb) throw new DelhiveryError('Delhivery accepted the order but returned no AWB — check Delhivery One before re-booking');
      booked = {
        awb: res.awb, courierName: 'Delhivery', courierOrderId: res.courierOrderId, shipmentRef: null,
        chargedAmount: null, pickupScheduledAt: null,
        rawRequest: (res.raw as any)?.request, rawResponse: (res.raw as any)?.response,
      };
    } else {
      booked = await bookWithShiprocket(draft.id, {
        ...common,
        to: { ...to, email: order.customerEmail },
        courierId: input.courierId!,
        pickupLocation: sCreds!.pickupLocation || null,
      });
    }

    const shipment = await prisma.shipment.update({
      where: { id: draft.id },
      data: {
        status: booked.pickupScheduledAt ? 'pickup_scheduled' : 'awb_assigned',
        awb: booked.awb,
        courierName: booked.courierName,
        courierOrderId: booked.courierOrderId,
        shipmentRef: booked.shipmentRef,
        chargedAmount: booked.chargedAmount,
        pickupScheduledAt: booked.pickupScheduledAt,
        rawRequest: (booked.rawRequest ?? undefined) as any,
        rawResponse: (booked.rawResponse ?? undefined) as any,
        lastError: null,
      },
    });
    await prisma.shipmentEvent.create({
      data: {
        shipmentId: shipment.id, status: 'AWB assigned', mappedStatus: 'awb_assigned',
        statusDetail: `Booked by admin · ${name}${provider === 'shiprocket' ? ` (${booked.courierName})` : ''} · ref ${booked.courierOrderId}`,
        occurredAt: new Date(),
      },
    }).catch(() => undefined);

    // The order moves to shipped and the customer gets the tracking email —
    // one applyOrderStatus call, so the email reads the AWB it just wrote.
    // Re-read the order: a webhook may have moved it while we were booking.
    const trackingFields = {
      carrierName: booked.courierName,
      trackingNumber: booked.awb,
      trackingUrl: trackingUrlFor(provider, booked.awb),
    };
    const now = await prisma.order.findUnique({ where: { id: orderId }, select: { orderStatus: true } });
    let emailSent = false;
    if (now && isForwardMove(now.orderStatus, 'shipped')) {
      const r = await applyOrderStatus(orderId, 'shipped', { source: 'shipment', fields: trackingFields });
      emailSent = r.emailSent;
    } else {
      await prisma.order.update({ where: { id: orderId }, data: trackingFields });
    }
    return { shipment, emailSent };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (booked) {
      // The AWB exists and is paid for; only our own bookkeeping failed.
      await prisma.shipment.update({
        where: { id: draft.id },
        data: {
          status: 'awb_assigned', awb: booked.awb, courierName: booked.courierName,
          courierOrderId: booked.courierOrderId, shipmentRef: booked.shipmentRef,
          lastError: `Booked, but saving it failed: ${msg}`.slice(0, 1000),
        },
      }).catch((e) => console.error('[shipments] could not record booked AWB', booked?.awb, e));
      throw new ShipmentError(`AWB ${booked.awb} was booked with ${name}, but updating the order failed (${msg}). Reload — do NOT book again.`);
    }
    // An unresolved Shiprocket order stays 'created' (blocking re-booking,
    // cancellable from the page); everything else is a clean failure.
    const keepOpen = err instanceof UnresolvedBookingError;
    await prisma.shipment.update({
      where: { id: draft.id },
      data: {
        ...(keepOpen ? {} : { status: 'failed' as const }),
        lastError: msg.slice(0, 1000),
        rawResponse: (err as any)?.raw ?? undefined,
      },
    });
    throw isCourierError(err) ? new ShipmentError(msg) : err;
  }
}

/**
 * Shiprocket: create the order, record it, then ask the chosen courier for an
 * AWB (this is the step that debits the wallet). If the AWB step fails the
 * Shiprocket order is cancelled — which also releases any AWB the courier did
 * assign — so it does not sit in their panel as a half-booking. If that
 * cancel fails too, the booking is UNRESOLVED and the row stays open.
 */
async function bookWithShiprocket(
  shipmentId: number,
  input: Parameters<typeof shiprocketCreate>[0] & { courierId: string },
): Promise<Booked> {
  const created = await shiprocketCreate(input);
  // Shiprocket may hand back an EXISTING order for a duplicate order_id. If
  // another of our rows already owns it, stop: assigning or cancelling here
  // would act on that other, live booking.
  const owner = await prisma.shipment.findFirst({
    where: { provider: 'shiprocket', courierOrderId: created.courierOrderId, id: { not: shipmentId } },
    select: { id: true },
  });
  if (owner) throw new ShipmentError('This order is already booked with Shiprocket by another request — reload the page');

  await prisma.shipment.update({
    where: { id: shipmentId },
    data: {
      status: 'created',
      courierOrderId: created.courierOrderId,
      shipmentRef: created.shipmentRef ?? null,
      rawRequest: ((created.raw as any)?.request ?? undefined) as any,
    },
  });

  const rollback = async (why: string): Promise<never> => {
    try {
      await shiprocketCancelOrder(created.courierOrderId);
    } catch (ce) {
      const cm = ce instanceof Error ? ce.message : String(ce);
      throw new UnresolvedBookingError(
        `${why} — AND Shiprocket order ${created.courierOrderId} could NOT be cancelled (${cm}). ` +
        'Check the Shiprocket panel, then press Cancel on this booking before booking again.',
      );
    }
    throw new ShiprocketError(`${why} (the Shiprocket order was cancelled; you can book again)`);
  };

  if (!created.shipmentRef) return rollback('Shiprocket created the order but returned no shipment id');

  let assigned: Awaited<ReturnType<typeof shiprocketAssignAwb>>;
  try {
    assigned = await shiprocketAssignAwb(created.shipmentRef, input.courierId);
  } catch (e) {
    return rollback(e instanceof Error ? e.message : String(e));
  }
  return {
    awb: assigned.awb,
    courierName: assigned.courierName || 'Shiprocket',
    courierOrderId: created.courierOrderId,
    shipmentRef: created.shipmentRef,
    chargedAmount: assigned.charge,
    pickupScheduledAt: assigned.pickupScheduledAt,
    rawRequest: (created.raw as any)?.request,
    rawResponse: { create: (created.raw as any)?.response, assign: assigned.raw },
  };
}

// ─── After booking ───────────────────────────────────────────────────────

async function loadShipment(id: number) {
  const s = await prisma.shipment.findUnique({ where: { id } });
  if (!s) throw new ShipmentError('Shipment not found');
  if (!s.awb) throw new ShipmentError('Shipment has no AWB');
  return s as Shipment & { awb: string };
}

function needRef(s: Shipment): string {
  if (!s.shipmentRef) throw new ShipmentError('Shiprocket shipment id is missing on this booking — use the Shiprocket panel');
  return s.shipmentRef;
}

function trackFor(s: Shipment & { awb: string }): Promise<TrackResult> {
  return s.provider === 'shiprocket' ? shiprocketTrack(s.awb) : delhiveryTrack(s.awb);
}

export async function shipmentLabel(id: number): Promise<string> {
  const s = await loadShipment(id);
  const url = s.provider === 'shiprocket' ? await shiprocketLabel(needRef(s)) : await delhiveryLabel(s.awb);
  if (!url) {
    throw new ShipmentError(`${PROVIDER_NAME[s.provider]} did not return a label yet — try again in a minute, or print it from their panel`);
  }
  await prisma.shipment.update({ where: { id }, data: { labelUrl: url } });
  return url;
}

export async function schedulePickup(id: number, when: Date) {
  const s = await loadShipment(id);
  if (TERMINAL.includes(s.status)) throw new ShipmentError(`Shipment is ${s.status}`);
  let pickupId: string | null = null;
  let scheduledFor: Date = when;
  if (s.provider === 'shiprocket') {
    // A shipment already in Shiprocket's queue (ours, or an auto-pickup
    // courier's) is refused unless the request says retry.
    let res;
    try {
      res = await shiprocketPickup(needRef(s), when, !!s.pickupScheduledAt);
    } catch (e) {
      if (!(e instanceof ShiprocketError && /already in pickup queue/i.test(e.message)) || s.pickupScheduledAt) throw e;
      res = await shiprocketPickup(needRef(s), when, true);
    }
    pickupId = res.pickupId;
    if (res.scheduledFor) scheduledFor = res.scheduledFor;
  } else {
    const c = await delhiveryCreds();
    const res = await delhiveryPickup(c.pickupLocation || c.clientName, when, 1);
    pickupId = res.pickupId ?? null;
  }
  const upd = await prisma.shipment.update({
    where: { id },
    data: {
      pickupScheduledAt: scheduledFor,
      status: s.status === 'awb_assigned' || s.status === 'created' ? 'pickup_scheduled' : s.status,
    },
  });
  await prisma.shipmentEvent.create({
    data: {
      shipmentId: id, status: 'Pickup requested', mappedStatus: 'pickup_scheduled',
      statusDetail: pickupId ? `Pickup id ${pickupId}` : null, occurredAt: new Date(),
    },
  }).catch(() => undefined);
  return { shipment: upd, pickupId };
}

/** Clear the order's tracking (if it still shows this AWB) and move a shipped
 *  order back to processing — silently: the customer already has an email we
 *  cannot unsend, and the re-booking sends the new one. */
async function releaseOrderFromAwb(
  orderId: number,
  awb: string | null,
  source: 'shipment' | 'poll' | 'webhook',
): Promise<{ cleared: boolean; reopened: boolean; status: OrderStatus | null }> {
  if (!awb) return { cleared: false, reopened: false, status: null };
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { orderStatus: true, trackingNumber: true } });
  if (!order || order.trackingNumber !== awb) return { cleared: false, reopened: false, status: order?.orderStatus ?? null };
  const reopened = order.orderStatus === 'shipped';
  await applyOrderStatus(orderId, reopened ? 'processing' : null, {
    source,
    silent: true,
    fields: { carrierName: null, trackingNumber: null, trackingUrl: null, shippedAt: null },
  });
  return { cleared: true, reopened, status: order.orderStatus };
}

async function noteOnOrder(orderId: number, line: string) {
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { internalNotes: true } });
  if (!o) return;
  const stamped = `[${today()}] ${line}`;
  await prisma.order.update({
    where: { id: orderId },
    data: { internalNotes: o.internalNotes ? `${o.internalNotes}\n${stamped}` : stamped },
  });
}

/**
 * Cancel with the courier. Only before pickup — once the parcel moves it is
 * a return, not a cancellation. The order goes back to processing and loses
 * the AWB, silently.
 *
 * Shiprocket cancels asynchronously ("in progress"): the row is marked
 * cancelled at once (so the order can be re-booked), but it keeps being
 * polled for a few days, and a scan showing the parcel moving anyway is
 * flagged on the order for a person. A Shiprocket booking left without an
 * AWB (an unresolved failure) is cancelled through its Shiprocket order.
 */
export async function cancelShipment(id: number) {
  const row = await prisma.shipment.findUnique({ where: { id } });
  if (!row) throw new ShipmentError('Shipment not found');
  if (!['awb_assigned', 'pickup_scheduled', 'created'].includes(row.status)) {
    throw new ShipmentError(`Cannot cancel a shipment that is ${row.status.replace(/_/g, ' ')} — contact ${PROVIDER_NAME[row.provider]} for a return`);
  }

  let note: string | null = null;
  if (row.provider === 'shiprocket') {
    if (row.awb) {
      await shiprocketCancelAwb(row.awb);
    } else if (!row.courierOrderId || !/^\d+$/.test(row.courierOrderId)) {
      throw new ShipmentError('This booking has no AWB and no Shiprocket order id — check the Shiprocket panel');
    }
    // Close the Shiprocket order too (it also releases an AWB assigned that
    // we never heard about). Its refusal is kept, not swallowed — "requested
    // for RTO" means the parcel had already moved.
    if (row.courierOrderId && /^\d+$/.test(row.courierOrderId)) {
      try {
        await shiprocketCancelOrder(row.courierOrderId);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (!row.awb) throw e; // nothing else was cancelled: report it plainly
        note = `Order cancel: ${m}`;
      }
    }
  } else {
    if (!row.awb) throw new ShipmentError('Shipment has no AWB');
    await delhiveryCancel(row.awb);
  }

  const upd = await prisma.shipment.update({
    where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), lastError: note },
  });
  await prisma.shipmentEvent.create({
    data: {
      shipmentId: id,
      status: row.provider === 'shiprocket' ? 'Cancellation requested' : 'Cancelled',
      mappedStatus: 'cancelled', statusDetail: note ?? 'Cancelled from admin', occurredAt: new Date(),
    },
  }).catch(() => undefined);
  await releaseOrderFromAwb(row.orderId, row.awb, 'shipment');
  return upd;
}

/** Pull the latest scans now (the poll does this hourly on its own). */
export async function refreshShipment(id: number) {
  const s = await loadShipment(id);
  const t = await trackFor(s);
  return applyCourierUpdate(s, t, 'poll');
}

// ─── Scans → shipment + order ────────────────────────────────────────────

const SHIPMENT_RANK: Record<ShipmentStatus, number> = {
  draft: 0, created: 1, awb_assigned: 2, pickup_scheduled: 3, in_transit: 4,
  out_for_delivery: 5, delivered: 6, rto: 6, cancelled: 7, failed: 7,
};

/** A shipment only moves forward, except that a return (rto) can follow any
 *  forward state short of delivered. A late "In Transit" never un-delivers. */
export function nextShipmentStatus(current: ShipmentStatus, incoming: ShipmentStatus | null): ShipmentStatus {
  if (!incoming || incoming === current) return current;
  if (current === 'cancelled' || current === 'delivered') return current;
  if (incoming === 'rto') return current === 'rto' ? current : 'rto';
  if (current === 'rto') return current;
  return SHIPMENT_RANK[incoming] > SHIPMENT_RANK[current] ? incoming : current;
}

/** States that mean the parcel physically moved. */
const MOVING: ShipmentStatus[] = ['in_transit', 'out_for_delivery', 'delivered', 'rto'];

/**
 * Record scans and move things forward. Used by the poll, the refresh button
 * and the webhook, so a scan has one meaning however it arrived.
 *
 * Decides from the row as it is NOW, not the caller's snapshot: a poll run
 * lasts many seconds, and a booking cancelled from the page in that time must
 * not be pushed back to shipped (with the dead AWB re-emailed).
 */
export async function applyCourierUpdate(
  shipment: Shipment,
  t: Pick<TrackResult, 'mapped' | 'events'>,
  source: 'poll' | 'webhook',
) {
  const cur = (await prisma.shipment.findUnique({ where: { id: shipment.id } })) ?? shipment;

  let recorded = 0;
  if (t.events.length) {
    const r = await prisma.shipmentEvent.createMany({
      data: t.events.map((e) => ({
        shipmentId: cur.id,
        status: e.status || '(blank)',
        mappedStatus: e.mapped,
        statusDetail: e.detail ?? null,
        location: e.location ?? null,
        occurredAt: e.occurredAt,
        raw: (e.raw ?? undefined) as any,
      })),
      // The unique (shipment, status, time) index makes a replay a no-op.
      skipDuplicates: true,
    });
    recorded = r.count;
  }

  // Current status wins; fall back to the newest mapped scan.
  const newest = [...t.events].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).find((e) => e.mapped)?.mapped ?? null;
  const incoming = t.mapped ?? newest;
  const next = nextShipmentStatus(cur.status, incoming);
  const firstCancel = next === 'cancelled' && cur.status !== 'cancelled';
  // We recorded a cancel, but the courier reports the parcel moving anyway.
  const cancelDidNotTake = cur.status === 'cancelled' && !!incoming && MOVING.includes(incoming)
    && !(cur.lastError ?? '').startsWith('CANCEL DID NOT TAKE');

  if (next !== cur.status) {
    // Conditional on the status we decided from, so a concurrent change wins.
    await prisma.shipment.updateMany({
      where: { id: cur.id, status: cur.status },
      data: { status: next, ...(firstCancel ? { cancelledAt: new Date() } : {}) },
    });
  }

  let orderChanged = false;
  const order = await prisma.order.findUnique({
    where: { id: cur.orderId },
    select: { id: true, orderStatus: true, trackingNumber: true, orderNumber: true },
  });
  if (order) {
    const want: OrderStatus | null = orderStatusFor(next);
    // Never mark an order shipped from a shipment we hold no AWB for — the
    // customer would get a shipping email without a tracking number.
    if (want && cur.awb && isForwardMove(order.orderStatus, want)) {
      const res = await applyOrderStatus(order.id, want, {
        source,
        fields: !order.trackingNumber
          ? {
              carrierName: cur.courierName ?? PROVIDER_NAME[cur.provider],
              trackingNumber: cur.awb,
              trackingUrl: trackingUrlFor(cur.provider, cur.awb),
            }
          : undefined,
      });
      orderChanged = res.changed;
    }
    // Cancelled at the courier's end (their panel, or the courier): release
    // the order the way the Cancel button does, so a re-booking emails the
    // new AWB instead of silently replacing a dead one.
    if (firstCancel) {
      const rel = await releaseOrderFromAwb(order.id, cur.awb, source);
      orderChanged = orderChanged || rel.cleared;
      const tail = rel.reopened
        ? ' — order back to Processing; book again to ship'
        : rel.cleared ? ` — tracking removed; order stays ${rel.status}` : '';
      await noteOnOrder(order.id, `${PROVIDER_NAME[cur.provider]}: AWB ${cur.awb ?? '(none)'} was CANCELLED at the courier${tail}.`);
    }
    if (cancelDidNotTake) {
      await prisma.shipment.update({
        where: { id: cur.id },
        data: { lastError: `CANCEL DID NOT TAKE — ${PROVIDER_NAME[cur.provider]} reports ${incoming}` },
      });
      await noteOnOrder(order.id,
        `${PROVIDER_NAME[cur.provider]}: AWB ${cur.awb} was cancelled from admin, but the courier now reports "${incoming}". Check with ${PROVIDER_NAME[cur.provider]} — the parcel may be moving.`);
      console.warn('[shipments]', order.orderNumber, 'cancel did not take on', cur.awb, incoming);
    }
    // A return is a decision for a person (refund? re-ship? credit note?).
    // Leave the order alone, but leave a note the first time.
    if (next === 'rto' && cur.status !== 'rto') {
      await noteOnOrder(order.id, `${PROVIDER_NAME[cur.provider]}: AWB ${cur.awb} is RETURNING to origin (RTO). Decide refund / re-ship.`);
      console.warn('[shipments]', order.orderNumber, 'RTO on', cur.awb);
    }
  }
  return { recorded, status: next, orderChanged };
}

/** A failure that will repeat for every shipment of this courier in this run
 *  (bad login, locked account, the courier not answering) — stop asking, or
 *  a lock gets longer and one slow courier eats the whole run. */
const ACCOUNT_LEVEL = /not configured|invalid email|password|blocked|too many|unauthori[sz]ed|locked|timeout|timed out|aborted|unavailable|fetch failed|could not reach/i;

/**
 * Hourly: refresh every open shipment of every connected courier, one at a
 * time, each courier with its own share of the run so one cannot crowd out
 * or stall the other. Delhivery allows 750 tracking requests / 5 min;
 * Shiprocket logs in once per 9 days (token cached). Far below both.
 */
export async function pollOpenShipments(limit = 60) {
  const providers = await providerStatus();
  // Delhivery first: its push webhook is not live, so this poll is the only
  // automatic path to "delivered" (stock, deliveredAt) for its parcels.
  const live = (['delhivery', 'shiprocket'] as ShipmentProvider[]).filter((p) => providers[p].configured);
  if (!live.length) return [];
  const whereFor = (provider: ShipmentProvider) => ({
    provider,
    awb: { not: null },
    OR: [
      { status: { notIn: [...TERMINAL, 'draft' as const] } },
      // Shiprocket cancels asynchronously — watch recent cancels.
      ...(provider === 'shiprocket'
        ? [{ status: 'cancelled' as const, cancelledAt: { gt: new Date(Date.now() - CANCEL_WATCH_MS) } }]
        : []),
    ],
  });
  // Each courier gets an equal share; whatever one does not need goes to the
  // other, so connecting Shiprocket never slows Delhivery's checks.
  const share = Math.floor(limit / live.length);
  const counts = await Promise.all(live.map((p) => prisma.shipment.count({ where: whereFor(p) })));
  let spare = limit - counts.reduce((a, c) => a + Math.min(c, share), 0);
  const takeOf = counts.map((c) => {
    const extra = Math.max(0, Math.min(spare, c - share));
    spare -= extra;
    return Math.min(c, share) + extra;
  });
  const out: Array<{ provider: ShipmentProvider; awb: string; status?: string; error?: string }> = [];

  for (const [i, provider] of live.entries()) {
    if (!takeOf[i]) continue;
    const open = await prisma.shipment.findMany({
      where: whereFor(provider),
      orderBy: { updatedAt: 'asc' },
      take: takeOf[i],
    });
    for (const s of open) {
      try {
        const t = await trackFor(s as Shipment & { awb: string });
        const r = await applyCourierUpdate(s, t, 'poll');
        // Touch the row so the oldest-first order rotates even when nothing
        // moved. A cancelled row keeps its note (it may have just been set).
        const keepNote = s.status === 'cancelled' || r.status === 'cancelled';
        await prisma.shipment.update({ where: { id: s.id }, data: keepNote ? { updatedAt: new Date() } : { lastError: null } });
        out.push({ provider, awb: s.awb!, status: r.status });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // A watched cancelled row keeps its note (CANCEL DID NOT TAKE is what
        // stops a repeat alert); the error is still in the run's output.
        await prisma.shipment.update({
          where: { id: s.id },
          data: s.status === 'cancelled' ? { updatedAt: new Date() } : { lastError: msg.slice(0, 500) },
        }).catch(() => undefined);
        out.push({ provider, awb: s.awb!, error: msg });
        if (err instanceof ShiprocketAuthError || ACCOUNT_LEVEL.test(msg)) {
          const left = open.length - open.indexOf(s) - 1;
          if (left) out.push({ provider, awb: '-', error: `${left} more skipped — account error: ${msg}` });
          break;
        }
      }
    }
  }
  return out;
}
