/**
 * Public shipping-quote endpoint.
 *
 * The storefront calls this from the checkout page once it knows the
 * destination state + cart, to SHOW the delivery charge before payment. It
 * uses the exact same `computeShipping` helper as the binding checkout route,
 * so the displayed amount can never differ from what the customer is charged.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fail, handleError, ok } from '@/lib/api';
import { computeShipping } from '@/lib/shipping-compute';

const schema = z.object({
  items: z
    .array(z.object({ sku: z.string().min(1), quantity: z.number().int().positive() }))
    .min(1),
  /** Destination state name (storefront sends address.state). Optional — the
   *  helper falls back to the seller's home zone when absent/unknown. */
  state: z.string().optional().nullable(),
  /** Order value after any coupon discount — drives the free-shipping cutoff. */
  amountAfterDiscount: z.number().nonnegative().default(0),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const { shippingCost, zone, totalGrams } = await computeShipping(body.items, {
      state: body.state ?? null,
      orderValueAfterDiscount: body.amountAfterDiscount,
    });
    return ok({ shippingCost, zone, totalGrams });
  } catch (e) {
    if (e instanceof z.ZodError) return fail('Invalid request', 400);
    return handleError(e);
  }
}
