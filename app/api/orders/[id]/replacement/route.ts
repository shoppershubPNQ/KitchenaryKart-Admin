/**
 * POST /api/orders/:id/replacement — raise a FREE replacement against a paid order whose item or part arrived
 * broken. Creates a linked ₹0 order (KK…-R1) ready to ship; see lib/replacement.ts for what it does and does not do.
 */
import { z } from 'zod';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { createReplacementOrder, ReplacementError } from '@/lib/replacement';

const lineSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('item'), orderItemId: z.number().int().positive(), quantity: z.number().int().positive() }),
  z.object({ kind: z.literal('sku'), sku: z.string().trim().min(1).max(80), quantity: z.number().int().positive() }),
  z.object({
    kind: z.literal('text'),
    name: z.string().trim().min(1).max(200),
    quantity: z.number().int().positive(),
    unitValue: z.number().positive(),
    taxPercent: z.number().min(0).max(28).optional(),
  }),
]);

const bodySchema = z.object({
  lines: z.array(lineSchema).min(1).max(30),
  reason: z.string().trim().min(3).max(500),
  shippingAddress: z.string().trim().max(500).nullable().optional(),
});

export const POST = withAuth(async (req, { params, user }) => {
  try {
    const id = parseInt(params.id);
    if (Number.isNaN(id)) return fail('Bad order id', 400);
    const body = bodySchema.parse(await req.json());
    const order = await createReplacementOrder(id, body, { id: user.id, name: user.name });
    return ok({ order: { id: order.id, orderNumber: order.orderNumber } }, { status: 201 });
  } catch (e) {
    if (e instanceof ReplacementError) return fail(e.message, 400);
    return handleError(e);
  }
}, ['admin', 'sales']);
