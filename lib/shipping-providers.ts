/**
 * The contract both couriers implement, plus the one place courier wording is
 * translated into our own ShipmentStatus.
 *
 * Shiprocket and Delhivery describe the same journey with different words and
 * different shapes. Everything above this file — the processing screen, the
 * webhooks, the tracking poll — works in these types and never in a courier's
 * own vocabulary, so adding a third courier later touches only its own module.
 */
import type { ShipmentProvider, ShipmentStatus, OrderStatus } from '@prisma/client';

export interface Address {
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  email?: string | null;
}

export interface PackageSpec {
  /** Centimetres. Blank is allowed — some couriers accept a weight-only
   *  booking — but a quote without them is only an estimate. */
  lengthCm?: number | null;
  breadthCm?: number | null;
  heightCm?: number | null;
  weightGrams: number;
}

export interface ShipmentLine {
  name: string;
  sku: string;
  units: number;
  /** GST-inclusive, matching how this catalogue stores every price. */
  sellingPrice: number;
  hsn?: string | null;
  taxPercent?: number | null;
}

export interface QuoteOption {
  provider: ShipmentProvider;
  courierId: string;
  courierName: string;
  /** Total the courier would charge us, in rupees. */
  charge: number;
  /** Days, when the courier states one. */
  etaDays?: number | null;
  /** What the courier will actually bill on — usually max(actual, volumetric). */
  chargeableWeightGrams?: number | null;
  rating?: number | null;
  serviceable: boolean;
  note?: string | null;
}

export interface CreateShipmentInput {
  orderNumber: string;
  orderDate: Date;
  to: Address;
  pkg: PackageSpec;
  lines: ShipmentLine[];
  /** Order total, GST-inclusive. Declared to the courier for RTO/insurance. */
  declaredValue: number;
  /** Prepaid throughout — this catalogue takes payment before dispatch and the
   *  owner confirmed there is no COD. Kept explicit so a future COD order
   *  cannot silently ship as prepaid. */
  paymentMode: 'Prepaid';
  /** Courier chosen from a quote; omitted lets the courier pick. */
  courierId?: string | null;
  pickupLocation?: string | null;
}

export interface CreateShipmentResult {
  courierOrderId: string;
  shipmentRef?: string | null;
  awb?: string | null;
  courierName?: string | null;
  chargedAmount?: number | null;
  raw: unknown;
}

export interface TrackResult {
  awb: string;
  currentStatus: string;
  mapped: ShipmentStatus | null;
  events: Array<{
    status: string;
    mapped: ShipmentStatus | null;
    detail?: string | null;
    location?: string | null;
    occurredAt: Date;
    raw?: unknown;
  }>;
  raw: unknown;
}

/**
 * Volumetric ("dimensional") weight in grams. Both Indian couriers use the
 * 5000 divisor on centimetres, and both bill on whichever is greater. Returns
 * null when any dimension is missing — the owner's decision is that these are
 * typed per shipment, so a blank box means "estimate on actual weight only",
 * not "assume zero".
 */
export function volumetricGrams(pkg: PackageSpec): number | null {
  const { lengthCm: l, breadthCm: b, heightCm: h } = pkg;
  if (!l || !b || !h) return null;
  return Math.round(((l * b * h) / 5000) * 1000);
}

/** What the courier will bill on: the greater of actual and volumetric. */
export function chargeableGrams(pkg: PackageSpec): number {
  const vol = volumetricGrams(pkg);
  return vol == null ? pkg.weightGrams : Math.max(pkg.weightGrams, vol);
}

/**
 * Courier scan wording -> our status. Matched on a lowercased, punctuation-
 * stripped key so "Out For Delivery", "out-for-delivery" and "OUT FOR
 * DELIVERY" all land together.
 *
 * Anything NOT in this table returns null. That is deliberate: an
 * unrecognised scan is recorded as an event but must never move the order —
 * a courier adding a new status string should not be able to mark something
 * delivered by accident.
 */
const STATUS_MAP: Record<string, ShipmentStatus> = {
  // shared / Shiprocket
  new: 'created',
  orderplaced: 'created',
  awbassigned: 'awb_assigned',
  labelgenerated: 'awb_assigned',
  pickupscheduled: 'pickup_scheduled',
  pickupgenerated: 'pickup_scheduled',
  pickupqueued: 'pickup_scheduled',
  pickuprescheduled: 'pickup_scheduled',
  pickedup: 'in_transit',
  shipped: 'in_transit',
  intransit: 'in_transit',
  outfordelivery: 'out_for_delivery',
  delivered: 'delivered',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  rto: 'rto',
  rtoinitiated: 'rto',
  rtoacknowledged: 'rto',
  rtodelivered: 'rto',
  undelivered: 'in_transit',
  lost: 'failed',
  damaged: 'failed',
  // Delhivery scan vocabulary
  manifested: 'created',
  inttransit: 'in_transit',
  dispatched: 'out_for_delivery',
  pending: 'in_transit',
  returned: 'rto',
};

export function mapCourierStatus(raw: string | null | undefined): ShipmentStatus | null {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[^a-z]/g, '');
  return STATUS_MAP[key] ?? null;
}

/**
 * Which order status a shipment status implies — and only where it is
 * unambiguous. Returns null for everything else so the order is left alone.
 *
 * `rto` deliberately maps to nothing: goods coming back is not the same as
 * `returned` (which in this codebase means an INVOICED sale came back and
 * needs a credit note). That call belongs to a human.
 */
export function orderStatusFor(s: ShipmentStatus): OrderStatus | null {
  switch (s) {
    case 'awb_assigned':
    case 'pickup_scheduled':
    case 'in_transit':
    case 'out_for_delivery':
      return 'shipped';
    case 'delivered':
      return 'delivered';
    default:
      return null;
  }
}

/** Public tracking page for the customer, mirrored onto Order.trackingUrl. */
export function trackingUrlFor(provider: ShipmentProvider, awb: string): string {
  return provider === 'shiprocket'
    ? `https://www.shiprocket.in/shipment-tracking/?awb=${encodeURIComponent(awb)}`
    : `https://www.delhivery.com/track/package/${encodeURIComponent(awb)}`;
}
