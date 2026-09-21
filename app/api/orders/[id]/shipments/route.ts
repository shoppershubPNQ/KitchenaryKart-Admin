/**
 * GET  /api/orders/:id/shipments   — the shipping panel: defaults + history
 * POST /api/orders/:id/shipments   — { action: 'quote' | 'book', to, pkg, … }
 *
 * 'quote' only asks Delhivery (no money moves). 'book' creates the AWB and
 * DEBITS THE DELHIVERY WALLET — the UI puts a confirm step in front of it.
 * Admin + staff: packing and booking is day-to-day dispatch work.
 */
import { z } from 'zod';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { shipmentPanel, quoteForOrder, bookShipment, ShipmentError } from '@/lib/shipments';
import { DelhiveryError } from '@/lib/integrations/delhivery';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const num = z.union([z.number(), z.string()]).transform((v) => (v === '' || v == null ? null : Number(v)))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0), 'Must be a number');

const bodySchema = z.object({
  action: z.enum(['quote', 'book']),
  to: z.object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(10).max(20),
    address: z.string().trim().min(3).max(400),
    city: z.string().trim().min(1).max(80),
    state: z.string().trim().max(80).default(''),
    pincode: z.string().trim().regex(/^\d{6}$/, 'Pincode must be 6 digits'),
  }),
  pkg: z.object({
    weightGrams: z.number().int().positive(),
    lengthCm: num.nullable().optional(),
    breadthCm: num.nullable().optional(),
    heightCm: num.nullable().optional(),
  }),
  ewaybill: z.string().trim().max(20).nullable().optional(),
  fragile: z.boolean().optional(),
});

function courierFail(e: unknown) {
  if (e instanceof ShipmentError || e instanceof DelhiveryError) return fail(e.message, 422);
  return handleError(e);
}

export const GET = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    if (Number.isNaN(id)) return fail('Bad order id', 400);
    return ok(await shipmentPanel(id));
  } catch (e) {
    return courierFail(e);
  }
}, ['admin', 'staff']);

export const POST = withAuth(async (req, { params, user }) => {
  try {
    const id = parseInt(params.id);
    if (Number.isNaN(id)) return fail('Bad order id', 400);
    const body = bodySchema.parse(await req.json());
    const input = {
      to: body.to,
      pkg: {
        weightGrams: body.pkg.weightGrams,
        lengthCm: body.pkg.lengthCm ?? null,
        breadthCm: body.pkg.breadthCm ?? null,
        heightCm: body.pkg.heightCm ?? null,
      },
      ewaybill: body.ewaybill ?? null,
      fragile: body.fragile ?? false,
    };
    if (body.action === 'quote') {
      return ok({ quotes: await quoteForOrder(id, input) });
    }
    const res = await bookShipment(id, input, user.id);
    console.log(`[shipments] ${user.email} booked AWB ${res.shipment.awb} for order ${id}`);
    return ok({ awb: res.shipment.awb, shipmentId: res.shipment.id, emailSent: res.emailSent });
  } catch (e) {
    return courierFail(e);
  }
}, ['admin', 'staff']);
