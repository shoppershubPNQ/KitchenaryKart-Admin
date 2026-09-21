/**
 * Booking and following a courier shipment for an order — Delhivery.
 *
 * The admin order page, the hourly poll and the courier webhook all come
 * through here, so a scan has the same effect whichever way it arrives:
 *
 *   quoteForOrder   → serviceability + rate estimate (no money moves)
 *   bookShipment    → AWB from Delhivery (THIS debits the Delhivery wallet)
 *   shipmentLabel / schedulePickup / cancelShipment / refreshShipment
 *   applyCourierUpdate → record scans, move shipment + order forward only
 *
 * Booking is only ever a person clicking a button. Nothing here books on its
 * own: every booking costs money.
 */
import type { OrderStatus, Shipment, ShipmentStatus } from '@prisma/client';
import { prisma } from './db';
import { applyOrderStatus } from './order-status';
import { parseGrams } from './shipping-zones';
import { formatInvoiceNumber } from './invoice-serial';
import {
  type Address, type PackageSpec, type QuoteOption, type TrackResult,
  orderStatusFor, trackingUrlFor, isForwardMove,
} from './shipping-providers';
import {
  delhiveryCreds, delhiveryQuote, delhiveryCreate, delhiveryLabel,
  delhiveryPickup, delhiveryCancel, delhiveryTrack, delhiveryServiceable,
  DelhiveryError, EWAYBILL_THRESHOLD,
} from './integrations/delhivery';

export class ShipmentError extends Error {}

/** Company address pincode — the fallback origin when Integrations has none. */
const DEFAULT_ORIGIN_PINCODE = '411048';

/** Shipments in these states are finished: no booking is "active", no poll. */
const TERMINAL: ShipmentStatus[] = ['delivered', 'rto', 'cancelled', 'failed'];

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

/** Delhivery wants a 10-digit mobile; strip +91 / 0 / spaces. */
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

async function originPincode(): Promise<string> {
  const c = await delhiveryCreds();
  return c.pickupPincode && /^\d{6}$/.test(c.pickupPincode) ? c.pickupPincode : DEFAULT_ORIGIN_PINCODE;
}

async function sellerGstin(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: 'company_gst' } });
  return (row?.value ?? '').trim() || '27AAQPR2976J1ZU';
}

/** What the order page needs to draw the shipping panel. */
export async function shipmentPanel(orderId: number) {
  const order = await loadOrder(orderId);
  const configured = await delhiveryCreds().then(() => true).catch(() => false);
  const weight = catalogueWeight(order);
  const declaredValue = Number(order.totalAmount ?? 0);
  const shipments = await prisma.shipment.findMany({
    where: { orderId },
    orderBy: { id: 'desc' },
    include: { events: { orderBy: { occurredAt: 'desc' }, take: 30 } },
  });
  return {
    configured,
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
  if (act) return `Already booked — AWB ${act.awb ?? '(pending)'}. Cancel it first to re-book.`;
  if (!order.items.length) return 'Order has no items';
  return null;
}

// ─── Quote ───────────────────────────────────────────────────────────────

export interface BookingInput {
  to: Address;
  pkg: PackageSpec;
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
  if (pkg.weightGrams > 200_000) throw new ShipmentError('Weight above 200 kg — book this as a heavy/B2B shipment in Delhivery One');
}

export async function pincodeCheck(pincode: string) {
  return delhiveryServiceable(pincode);
}

export async function quoteForOrder(orderId: number, input: BookingInput): Promise<QuoteOption[]> {
  await loadOrder(orderId);
  validate(input);
  return delhiveryQuote(await originPincode(), input.to, input.pkg);
}

// ─── Book ────────────────────────────────────────────────────────────────

export async function bookShipment(orderId: number, input: BookingInput, adminId: number | null) {
  const order = await loadOrder(orderId);
  const blocked = bookingBlocker(order);
  if (blocked) throw new ShipmentError(blocked);
  validate(input);

  const declaredValue = Number(order.totalAmount ?? 0);
  if (declaredValue > EWAYBILL_THRESHOLD && !input.ewaybill?.trim()) {
    throw new ShipmentError(`Order value is above ₹${EWAYBILL_THRESHOLD.toLocaleString('en-IN')} — enter the e-way bill number`);
  }

  // Delhivery needs a unique order id per booking when it assigns the AWB.
  // First booking uses the order number as-is; a re-booking after a cancel or
  // failure gets -2, -3… The same reference twice is also what makes a double
  // click fail at Delhivery instead of booking (and paying for) two AWBs.
  const previous = order.shipments.filter((s) => s.provider === 'delhivery' && s.status !== 'draft').length;
  const reference = previous ? `${order.orderNumber}-${previous + 1}` : order.orderNumber;

  const c = await delhiveryCreds();
  const pickupLocation = c.pickupLocation || c.clientName;
  const to = { ...input.to, phone: normalisePhone(input.to.phone) };

  const draft = await prisma.shipment.create({
    data: {
      orderId,
      provider: 'delhivery',
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
    },
  });

  try {
    const res = await delhiveryCreate({
      orderNumber: reference,
      orderDate: order.createdAt,
      to,
      pkg: input.pkg,
      lines: order.items.map((it) => ({
        name: it.productName ?? it.product?.name ?? it.productSku ?? 'Item',
        sku: it.productSku ?? '',
        units: it.quantity,
        sellingPrice: Number(it.unitPrice),
        hsn: it.product?.hsnCode ?? null,
        taxPercent: Number(it.taxPercent),
      })),
      declaredValue,
      paymentMode: 'Prepaid',
      pickupLocation,
      sellerGstin: await sellerGstin(),
      consigneeGstin: order.customerGstin,
      ewaybill: input.ewaybill ?? null,
      fragile: !!input.fragile,
      invoiceNumber: order.invoiceSerial && order.invoiceFinancialYear
        ? formatInvoiceNumber(order.invoiceFinancialYear, order.invoiceSerial)
        : null,
    });
    if (!res.awb) throw new DelhiveryError('Delhivery accepted the order but returned no AWB — check Delhivery One before re-booking');

    const shipment = await prisma.shipment.update({
      where: { id: draft.id },
      data: {
        status: 'awb_assigned',
        awb: res.awb,
        courierName: 'Delhivery',
        courierOrderId: res.courierOrderId,
        rawRequest: (res.raw as any)?.request ?? undefined,
        rawResponse: (res.raw as any)?.response ?? undefined,
        lastError: null,
      },
    });
    await prisma.shipmentEvent.create({
      data: {
        shipmentId: shipment.id, status: 'AWB assigned', mappedStatus: 'awb_assigned',
        statusDetail: `Booked by admin · ref ${res.courierOrderId}`, occurredAt: new Date(),
      },
    }).catch(() => undefined);

    // The order moves to shipped and the customer gets the tracking email —
    // one applyOrderStatus call, so the email reads the AWB it just wrote.
    let emailSent = false;
    if (isForwardMove(order.orderStatus, 'shipped')) {
      const r = await applyOrderStatus(orderId, 'shipped', {
        source: 'shipment',
        fields: {
          carrierName: 'Delhivery',
          trackingNumber: res.awb,
          trackingUrl: trackingUrlFor('delhivery', res.awb),
        },
      });
      emailSent = r.emailSent;
    } else {
      await prisma.order.update({
        where: { id: orderId },
        data: { carrierName: 'Delhivery', trackingNumber: res.awb, trackingUrl: trackingUrlFor('delhivery', res.awb) },
      });
    }
    return { shipment, emailSent };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.shipment.update({
      where: { id: draft.id },
      data: {
        status: 'failed',
        lastError: msg.slice(0, 1000),
        rawResponse: (err as any)?.raw ?? undefined,
      },
    });
    throw err instanceof DelhiveryError ? new ShipmentError(msg) : err;
  }
}

// ─── After booking ───────────────────────────────────────────────────────

async function loadShipment(id: number) {
  const s = await prisma.shipment.findUnique({ where: { id } });
  if (!s) throw new ShipmentError('Shipment not found');
  if (s.provider !== 'delhivery') throw new ShipmentError('Only Delhivery shipments are handled here');
  if (!s.awb) throw new ShipmentError('Shipment has no AWB');
  return s as Shipment & { awb: string };
}

export async function shipmentLabel(id: number): Promise<string> {
  const s = await loadShipment(id);
  const url = await delhiveryLabel(s.awb);
  if (!url) throw new ShipmentError('Delhivery did not return a label yet — try again in a minute, or print it from Delhivery One');
  await prisma.shipment.update({ where: { id }, data: { labelUrl: url } });
  return url;
}

export async function schedulePickup(id: number, when: Date) {
  const s = await loadShipment(id);
  if (TERMINAL.includes(s.status)) throw new ShipmentError(`Shipment is ${s.status}`);
  const c = await delhiveryCreds();
  const res = await delhiveryPickup(c.pickupLocation || c.clientName, when, 1);
  const upd = await prisma.shipment.update({
    where: { id },
    data: {
      pickupScheduledAt: when,
      status: s.status === 'awb_assigned' || s.status === 'created' ? 'pickup_scheduled' : s.status,
    },
  });
  await prisma.shipmentEvent.create({
    data: {
      shipmentId: id, status: 'Pickup requested', mappedStatus: 'pickup_scheduled',
      statusDetail: res.pickupId ? `Pickup id ${res.pickupId}` : null, occurredAt: new Date(),
    },
  }).catch(() => undefined);
  return { shipment: upd, pickupId: res.pickupId };
}

/** Cancel with Delhivery. Only before pickup — once the parcel moves it is a
 *  return, not a cancellation. The order goes back to processing and loses
 *  the AWB, silently: the customer already has an email we cannot unsend. */
export async function cancelShipment(id: number) {
  const s = await loadShipment(id);
  if (!['awb_assigned', 'pickup_scheduled', 'created'].includes(s.status)) {
    throw new ShipmentError(`Cannot cancel a shipment that is ${s.status.replace(/_/g, ' ')} — contact Delhivery for a return`);
  }
  await delhiveryCancel(s.awb);
  const upd = await prisma.shipment.update({
    where: { id }, data: { status: 'cancelled', cancelledAt: new Date() },
  });
  await prisma.shipmentEvent.create({
    data: { shipmentId: id, status: 'Cancelled', mappedStatus: 'cancelled', statusDetail: 'Cancelled from admin', occurredAt: new Date() },
  }).catch(() => undefined);
  const order = await prisma.order.findUnique({ where: { id: s.orderId }, select: { orderStatus: true, trackingNumber: true } });
  if (order && order.trackingNumber === s.awb) {
    await applyOrderStatus(s.orderId, order.orderStatus === 'shipped' ? 'processing' : null, {
      source: 'shipment',
      silent: true,
      fields: { carrierName: null, trackingNumber: null, trackingUrl: null, shippedAt: null },
    });
  }
  return upd;
}

/** Pull the latest scans now (the poll does this hourly on its own). */
export async function refreshShipment(id: number) {
  const s = await loadShipment(id);
  const t = await delhiveryTrack(s.awb);
  return applyCourierUpdate(s, t, 'poll');
}

// ─── Scans → shipment + order ────────────────────────────────────────────

const SHIPMENT_RANK: Record<ShipmentStatus, number> = {
  draft: 0, created: 1, awb_assigned: 2, pickup_scheduled: 3, in_transit: 4,
  out_for_delivery: 5, delivered: 6, rto: 6, cancelled: 7, failed: 7,
};

/** A shipment only moves forward, except that a return (rto) can follow any
 *  forward state short of delivered. A late "In Transit" never un-delivers. */
function nextShipmentStatus(current: ShipmentStatus, incoming: ShipmentStatus | null): ShipmentStatus {
  if (!incoming || incoming === current) return current;
  if (current === 'cancelled' || current === 'delivered') return current;
  if (incoming === 'rto') return current === 'rto' ? current : 'rto';
  if (current === 'rto') return current;
  return SHIPMENT_RANK[incoming] > SHIPMENT_RANK[current] ? incoming : current;
}

/**
 * Record scans and move things forward. Used by the poll, the refresh button
 * and the webhook, so a scan has one meaning however it arrived.
 */
export async function applyCourierUpdate(
  shipment: Shipment,
  t: Pick<TrackResult, 'mapped' | 'events'>,
  source: 'poll' | 'webhook',
) {
  let recorded = 0;
  if (t.events.length) {
    const r = await prisma.shipmentEvent.createMany({
      data: t.events.map((e) => ({
        shipmentId: shipment.id,
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
  const next = nextShipmentStatus(shipment.status, incoming);
  if (next !== shipment.status) {
    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: next } });
  }

  const order = await prisma.order.findUnique({
    where: { id: shipment.orderId },
    select: { id: true, orderStatus: true, trackingNumber: true, internalNotes: true, orderNumber: true },
  });
  let orderChanged = false;
  if (order) {
    const want: OrderStatus | null = orderStatusFor(next);
    if (want && isForwardMove(order.orderStatus, want)) {
      const res = await applyOrderStatus(order.id, want, {
        source,
        fields: !order.trackingNumber && shipment.awb
          ? { carrierName: 'Delhivery', trackingNumber: shipment.awb, trackingUrl: trackingUrlFor('delhivery', shipment.awb) }
          : undefined,
      });
      orderChanged = res.changed;
    }
    // A return is a decision for a person (refund? re-ship? credit note?).
    // Leave the order alone, but leave a note the first time.
    if (next === 'rto' && shipment.status !== 'rto') {
      const line = `[${new Date().toISOString().slice(0, 10)}] Delhivery: AWB ${shipment.awb} is RETURNING to origin (RTO). Decide refund / re-ship.`;
      await prisma.order.update({
        where: { id: order.id },
        data: { internalNotes: order.internalNotes ? `${order.internalNotes}\n${line}` : line },
      });
      console.warn('[shipments]', order.orderNumber, 'RTO on', shipment.awb);
    }
  }
  return { recorded, status: next, orderChanged };
}

/** Hourly: refresh every open Delhivery shipment. Tracking allows 750
 *  requests / 5 min; this stays far below that and runs one at a time. */
export async function pollOpenShipments(limit = 60) {
  const open = await prisma.shipment.findMany({
    where: { provider: 'delhivery', awb: { not: null }, status: { notIn: [...TERMINAL, 'draft'] } },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  });
  const out: Array<{ awb: string; status?: string; error?: string }> = [];
  for (const s of open) {
    try {
      const t = await delhiveryTrack(s.awb!);
      const r = await applyCourierUpdate(s, t, 'poll');
      // Touch the row so the oldest-first order rotates even when nothing moved.
      if (r.status === s.status) await prisma.shipment.update({ where: { id: s.id }, data: { lastError: null } });
      out.push({ awb: s.awb!, status: r.status });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.shipment.update({ where: { id: s.id }, data: { lastError: msg.slice(0, 500) } }).catch(() => undefined);
      out.push({ awb: s.awb!, error: msg });
    }
  }
  return out;
}
