/**
 * POST /api/orders/quote
 *
 * Prices a manual order WITHOUT creating it, so the operator can see the exact
 * breakdown — net value, discount, GST, freight and the rounded payable —
 * before committing, and before a payment link is raised for that amount.
 *
 * Deliberately the same helper the create route uses, so the quote and the
 * order can never disagree.
 */
import { withAuth } from '@/lib/auth';
import { handleError, ok, fail } from '@/lib/api';
import { priceManualOrder, ManualOrderPricingError } from '@/lib/manual-order-pricing';
import { z } from 'zod';

const schema = z.object({
  shippingAddress: z.string().optional().nullable(),
  shippingCost: z.number().nonnegative().optional(),
  discountAmount: z.number().nonnegative().optional(),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive().optional(),
        sku: z.string().optional(),
        quantity: z.number().int().positive(),
        unitPrice: z.number().nonnegative().optional(),
        taxPercent: z.number().nonnegative().optional(),
      }),
    )
    .min(1),
});

export const POST = withAuth(async (req) => {
  try {
    const body = schema.parse(await req.json());
    try {
      const p = await priceManualOrder(body);
      return ok({
        lines: p.lines,
        summary: p.summary,
        shipping: {
          cost: p.shippingCost,
          auto: p.shippingAuto,
          zone: p.shippingZone,
          grams: p.shippingGrams,
          state: p.shippingState,
          rate: p.shippingRate,
          gst: Math.round(p.shippingCost * (p.shippingRate / 100) * 100) / 100,
        },
      });
    } catch (e) {
      if (e instanceof ManualOrderPricingError) return fail(e.message, 400);
      throw e;
    }
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales']);
