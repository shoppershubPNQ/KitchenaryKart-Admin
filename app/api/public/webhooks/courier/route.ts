/**
 * POST /api/public/webhooks/courier — courier status push.
 *
 * ONE endpoint for both couriers. Shiprocket refuses to accept a webhook URL
 * containing "shiprocket", "sr" or "kr", so the provider cannot be named in
 * the path; and putting the secret in the path would leak it into every access
 * log between here and the courier. So the PROVIDER IS IDENTIFIED BY THE
 * SECRET IT PRESENTS — each has its own, minted when its credentials are saved.
 *
 * Modelled on the Razorpay webhook: read, verify, and return 200 for anything
 * not handled so the sender stops retrying. Neither courier signs its payload
 * — both let us choose a header — so this shared secret is the whole of the
 * authentication. Compared in constant time.
 *
 * Not withAuth: the caller is a courier, not an admin session.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { fail, ok } from '@/lib/api';
import { safeEqual } from '@/lib/crypto';
import { applyOrderStatus } from '@/lib/order-status';
import { mapCourierStatus, orderStatusFor, trackingUrlFor } from '@/lib/shipping-providers';
import type { ShipmentProvider, ShipmentStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

/** Couriers differ on which header carries the token — Shiprocket's panel
 *  offers a choice — so accept the usual ones rather than dictating. */
function presentedSecret(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  const bearer = auth?.replace(/^Bearer\s+/i, '').replace(/^Token\s+/i, '').trim();
  return (
    req.headers.get('x-api-key') ??
    req.headers.get('x-webhook-secret') ??
    (bearer || null)
  );
}

/** Which account sent this. Every stored secret is compared in constant time,
 *  and all of them are checked so the work does not vary with the answer. */
async function identify(secret: string): Promise<ShipmentProvider | null> {
  const rows = await prisma.integrationCredential.findMany({
    select: { provider: true, webhookSecret: true },
  });
  let found: ShipmentProvider | null = null;
  for (const r of rows) if (safeEqual(secret, r.webhookSecret)) found = r.provider;
  return found;
}

/** Dig the AWB and status out of either courier's payload shape. */
function readPayload(body: any): { awb: string | null; status: string | null; detail: string | null; location: string | null; at: Date } {
  // Delhivery: { Shipment: { AWB, Status: { Status, StatusDateTime, ... } } }
  const s = body?.Shipment;
  if (s) {
    const st = s.Status ?? {};
    return {
      awb: s.AWB ? String(s.AWB) : null,
      status: st.Status ? String(st.Status) : null,
      detail: st.Instructions ? String(st.Instructions) : null,
      location: st.StatusLocation ? String(st.StatusLocation) : null,
      at: st.StatusDateTime ? new Date(st.StatusDateTime) : new Date(),
    };
  }
  // Shiprocket: flat, { awb, current_status, ... }
  const awb = body?.awb ?? body?.awb_code ?? null;
  const status = body?.current_status ?? body?.shipment_status ?? body?.status ?? null;
  return {
    awb: awb ? String(awb) : null,
    status: status ? String(status) : null,
    detail: body?.activity ?? body?.current_status_desc ?? null,
    location: body?.location ?? null,
    at: body?.current_timestamp || body?.scan_date ? new Date(body.current_timestamp ?? body.scan_date) : new Date(),
  };
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  const secret = presentedSecret(req);
  if (!secret) return fail('Missing webhook token', 401);
  const provider = await identify(secret);
  if (!provider) return fail('Invalid webhook token', 401);

  let body: any;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    // 200, not 400: a malformed body is not something retrying will fix.
    console.warn('[courier-webhook] unparseable body from', provider);
    return ok({ ignored: true, reason: 'unparseable' });
  }

  const { awb, status, detail, location, at } = readPayload(body);
  if (!awb || !status) {
    console.warn('[courier-webhook]', provider, 'payload had no awb/status');
    return ok({ ignored: true, reason: 'no awb or status' });
  }

  const shipment = await prisma.shipment.findUnique({
    where: { awb },
    include: { order: { select: { id: true, orderNumber: true, orderStatus: true } } },
  });
  // An AWB we never booked (a test ping, or a shipment made in the courier's
  // own panel). Acknowledge so they stop retrying.
  if (!shipment) {
    console.warn('[courier-webhook]', provider, 'unknown AWB', awb);
    return ok({ unmatched: true, awb });
  }

  const mapped: ShipmentStatus | null = mapCourierStatus(status);
  const occurredAt = Number.isNaN(at.getTime()) ? new Date() : at;

  // Record the scan first, always — even one we cannot interpret. The unique
  // index makes a replay a no-op rather than a duplicate row.
  try {
    await prisma.shipmentEvent.create({
      data: {
        shipmentId: shipment.id,
        status,
        mappedStatus: mapped,
        statusDetail: detail,
        location,
        occurredAt,
        raw: body,
      },
    });
  } catch {
    // Unique violation = we already have this scan. Nothing to do.
  }

  if (!mapped) {
    // Deliberately does NOT touch the order. A courier adding a new status
    // string must not be able to mark something delivered by accident.
    console.warn('[courier-webhook]', provider, 'unmapped status:', status);
    return ok({ recorded: true, mapped: null, status });
  }

  if (shipment.status !== mapped) {
    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: mapped } });
  }

  // Move the order only where the meaning is unambiguous. orderStatusFor
  // returns null for rto and cancelled — goods coming back is a decision for a
  // human, not a scan.
  const nextOrderStatus = orderStatusFor(mapped);
  let orderChanged = false;
  if (nextOrderStatus && shipment.order.orderStatus !== nextOrderStatus) {
    const res = await applyOrderStatus(shipment.orderId, nextOrderStatus, {
      source: 'webhook',
      // Mirror the AWB onto the order the first time, so /track and the
      // shipping email have something to show.
      fields: shipment.order.orderStatus === 'processing'
        ? {
            carrierName: shipment.courierName ?? provider,
            trackingNumber: awb,
            trackingUrl: trackingUrlFor(provider, awb),
          }
        : undefined,
    });
    orderChanged = res.changed;
  }

  return ok({ recorded: true, awb, mapped, orderChanged });
}

/** Some couriers probe the URL with a GET before accepting it. */
export async function GET() {
  return ok({ ready: true });
}
