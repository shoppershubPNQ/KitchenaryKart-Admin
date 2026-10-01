/**
 * POST /api/public/webhooks/courier — courier status push.
 *
 * ONE endpoint for both couriers. Shiprocket refuses to accept a webhook URL
 * containing "shiprocket", "kartrocket", "sr" or "kr", so the provider cannot
 * be named in the path; and putting the secret in the path would leak it into
 * every access log between here and the courier. So the PROVIDER IS
 * IDENTIFIED BY THE SECRET IT PRESENTS — each has its own, minted when its
 * credentials are saved.
 *
 * Modelled on the Razorpay webhook: read, verify, and return 200 for anything
 * not handled so the sender stops retrying. Neither courier signs its payload
 * — both let us choose a header (Shiprocket sends it as x-api-key) — so this
 * shared secret is the whole of the authentication. Compared in constant time.
 *
 * Both couriers go through applyCourierUpdate, the same code as the hourly
 * poll and the Refresh button: a scan means the same thing however it
 * arrived, and nothing a courier sends can move a shipment or order backwards.
 *
 * Not withAuth: the caller is a courier, not an admin session.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { fail, ok } from '@/lib/api';
import { safeEqual } from '@/lib/crypto';
import { mapDelhiveryStatus, delhiveryTime, mapShiprocketStatus, shiprocketTime } from '@/lib/shipping-providers';
import type { TrackResult } from '@/lib/shipping-providers';
import { applyCourierUpdate } from '@/lib/shipments';
import type { ShipmentProvider } from '@prisma/client';

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

type Update = Pick<TrackResult, 'mapped' | 'events'>;

/** Delhivery: { Shipment: { AWB, NSLCode, Status: { Status, StatusType, StatusDateTime, … } } } */
function readDelhivery(body: any): { awb: string | null; update: Update | null } {
  const s = body?.Shipment;
  if (!s) return { awb: null, update: null };
  const st = s.Status ?? {};
  const status = st.Status ? String(st.Status) : null;
  if (!status) return { awb: s.AWB ? String(s.AWB) : null, update: null };
  // UD forward / RT returning / DL delivered — the words alone are ambiguous;
  // the push carries the scan code as NSLCode (DTUP-210 = seller cancelled).
  const mapped = mapDelhiveryStatus(status, st.StatusType, null, st.StatusCode ?? s.NSLCode ?? null);
  return {
    awb: s.AWB ? String(s.AWB) : null,
    update: {
      mapped,
      events: [{
        status,
        mapped,
        detail: st.Instructions ? String(st.Instructions) : null,
        location: st.StatusLocation ? String(st.StatusLocation) : null,
        // No zone in Delhivery timestamps: they are IST.
        occurredAt: delhiveryTime(st.StatusDateTime) ?? new Date(),
        raw: body,
      }],
    },
  };
}

/**
 * Shiprocket: flat { awb, sr_order_id, current_status, shipment_status_id,
 * current_timestamp ("DD MM YYYY HH:mm:ss"), scans: [{date, activity,
 * location, "sr-status", "sr-status-label"}] }. Status from the SHIPMENT code
 * (shipment_status_id) — current_status_id is from Shiprocket's order table
 * and means something else for the same number.
 */
function readShiprocket(body: any): { awb: string | null; srOrderId: string | null; update: Update | null } {
  const awb = body?.awb ?? body?.awb_code ?? null;
  const srOrderId = body?.sr_order_id != null ? String(body.sr_order_id) : null;
  const label = body?.current_status ?? body?.shipment_status ?? null;
  const mapped = mapShiprocketStatus(body?.shipment_status_id, label);
  const scans: any[] = Array.isArray(body?.scans) ? body.scans : [];
  const events: Update['events'] = scans.map((a) => {
    const l = a?.['sr-status-label'] && a['sr-status-label'] !== 'NA' ? String(a['sr-status-label']) : '';
    return {
      status: (l || String(a?.status ?? a?.activity ?? '')).slice(0, 120),
      mapped: mapShiprocketStatus(a?.['sr-status'], l),
      detail: a?.activity ?? null,
      location: a?.location ?? null,
      occurredAt: shiprocketTime(a?.date) ?? new Date(),
      raw: a,
    };
  });
  // No scans in the push (a cancel can arrive bare): record the headline.
  if (!events.length && label) {
    events.push({
      status: String(label).slice(0, 120),
      mapped,
      detail: body?.current_status_desc ?? null,
      location: null,
      occurredAt: shiprocketTime(body?.current_timestamp) ?? new Date(),
      raw: body,
    });
  }
  return {
    awb: awb ? String(awb) : null,
    srOrderId,
    update: label || events.length ? { mapped, events } : null,
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

  const parsed = provider === 'delhivery'
    ? { ...readDelhivery(body), srOrderId: null as string | null }
    : readShiprocket(body);
  if (!parsed.update) {
    console.warn('[courier-webhook]', provider, 'payload had no status');
    return ok({ ignored: true, reason: 'no status' });
  }

  // Match on the AWB. A Shiprocket push may arrive before we have stored the
  // AWB (it lands while our booking is still saving), or without one (a
  // cancel), so fall back to Shiprocket's own order id stored at booking.
  let shipment = parsed.awb ? await prisma.shipment.findUnique({ where: { awb: parsed.awb } }) : null;
  if (!shipment && parsed.srOrderId) {
    const byOrder = await prisma.shipment.findFirst({
      where: { provider: 'shiprocket', courierOrderId: parsed.srOrderId },
      orderBy: { id: 'desc' },
    });
    if (byOrder && parsed.awb && byOrder.awb && byOrder.awb !== parsed.awb) {
      // A different AWB under the same Shiprocket order (reassigned in their
      // panel). Not ours to apply; a person should look.
      console.warn('[courier-webhook] shiprocket order', parsed.srOrderId, 'pushed AWB', parsed.awb, 'but we hold', byOrder.awb);
      return ok({ unmatched: true, awb: parsed.awb, reason: 'awb differs from the booking' });
    }
    if (byOrder && parsed.awb && !byOrder.awb) {
      // Adopt the AWB Shiprocket assigned (only if still unset).
      await prisma.shipment.updateMany({
        where: { id: byOrder.id, awb: null },
        data: { awb: parsed.awb, courierName: body?.courier_name ? String(body.courier_name) : byOrder.courierName },
      });
      shipment = await prisma.shipment.findUnique({ where: { id: byOrder.id } });
    } else {
      shipment = byOrder;
    }
  }
  // An AWB we never booked (a test ping, or a shipment made in the courier's
  // own panel). Acknowledge so they stop retrying.
  if (!shipment || shipment.provider !== provider) {
    console.warn('[courier-webhook]', provider, 'unknown shipment', parsed.awb ?? parsed.srOrderId);
    return ok({ unmatched: true, awb: parsed.awb });
  }

  const r = await applyCourierUpdate(shipment, parsed.update, 'webhook');
  return ok({ recorded: r.recorded, awb: shipment.awb, status: r.status, orderChanged: r.orderChanged });
}

/** Some couriers probe the URL with a GET before accepting it. */
export async function GET() {
  return ok({ ready: true });
}
