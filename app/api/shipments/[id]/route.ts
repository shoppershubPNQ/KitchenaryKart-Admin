/**
 * POST /api/shipments/:id  — { action: 'label' | 'pickup' | 'cancel' | 'refresh', when? }
 *
 * Everything after a booking. 'cancel' only works before pickup; after that
 * it is a return and belongs in Delhivery One.
 */
import { z } from 'zod';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import {
  shipmentLabel, schedulePickup, cancelShipment, refreshShipment, ShipmentError,
} from '@/lib/shipments';
import { DelhiveryError } from '@/lib/integrations/delhivery';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  action: z.enum(['label', 'pickup', 'cancel', 'refresh']),
  /** Pickup moment, ISO string. Must be in the future. */
  when: z.string().datetime({ offset: true }).optional(),
});

export const POST = withAuth(async (req, { params, user }) => {
  try {
    const id = parseInt(params.id);
    if (Number.isNaN(id)) return fail('Bad shipment id', 400);
    const body = bodySchema.parse(await req.json());
    switch (body.action) {
      case 'label':
        return ok({ url: await shipmentLabel(id) });
      case 'pickup': {
        const when = body.when ? new Date(body.when) : null;
        if (!when || when.getTime() < Date.now() - 5 * 60_000) return fail('Choose a pickup time in the future', 400);
        const r = await schedulePickup(id, when);
        return ok({ pickupId: r.pickupId, status: r.shipment.status });
      }
      case 'cancel': {
        const r = await cancelShipment(id);
        console.log(`[shipments] ${user.email} cancelled AWB ${r.awb}`);
        return ok({ status: r.status });
      }
      case 'refresh':
        return ok(await refreshShipment(id));
    }
  } catch (e) {
    if (e instanceof ShipmentError || e instanceof DelhiveryError) return fail(e.message, 422);
    return handleError(e);
  }
}, ['admin', 'staff']);
