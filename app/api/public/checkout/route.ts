/**
 * Public storefront checkout endpoint.
 * Creates an Order + OrderItems + a Razorpay order in one transaction.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { fail, handleError, ok } from '@/lib/api';
import { createRazorpayOrder } from '@/lib/integrations/razorpay';
import { validateCoupon } from '@/lib/coupon';

// Shipping: free once the after-discount amount reaches the threshold,
// flat fee below it. Keep in sync with web/lib/shipping.ts and the
// Merchant Center shipping policy.
const FREE_SHIPPING_THRESHOLD = 3000;
const SHIPPING_FEE = 399;

/** Indian GSTIN: 2-digit state + 10-char PAN + entity + 'Z' + checksum. */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

const schema = z.object({
  /** Logged-in customer's account id (from the web auth session). Optional
   *  + verified server-side, so a missing/invalid id never blocks the
   *  order — it just falls back to an unlinked order, as before. Links the
   *  paid order to the account so it shows in "My Orders". */
  customerId: z.number().int().positive().optional(),
  customerName: z.string().min(1),
  customerEmail: z.string().email().optional().or(z.literal('')),
  customerPhone: z.string().min(1),
  shippingAddress: z.string().min(1),
  /** Optional buyer GSTIN for B2B orders. Lenient here so a malformed value
   *  never breaks checkout — it's re-validated below and dropped if invalid. */
  customerGstin: z.string().nullish(),
  /** Optional coupon code. Re-validated server-side — the client-sent
   *  discount (if any) is never trusted. */
  couponCode: z.string().optional().nullable(),
  items: z
    .array(
      z.object({
        sku: z.string(),
        name: z.string().optional().default(''),
        price: z.number().positive(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());

    const skus = body.items.map((i) => i.sku);
    const products = await prisma.product.findMany({
      where: { sku: { in: skus } },
      select: { id: true, sku: true, name: true, price: true, taxPercent: true },
    });
    const productMap = new Map(products.map((p) => [p.sku, p]));

    let subtotal = 0;
    const itemsToCreate = body.items.map((i) => {
      const p = productMap.get(i.sku);
      const unitPrice = p ? Number(p.price) : i.price;
      const lineTotal = unitPrice * i.quantity;
      subtotal += lineTotal;
      return {
        productId: p?.id,
        productSku: i.sku,
        productName: p?.name || i.name || i.sku,
        unitPrice,
        quantity: i.quantity,
        taxPercent: p ? Number(p.taxPercent) : 18,
        lineTotal,
      };
    });

    // Coupon: re-validate server-side (NEVER trust a client-sent
    // discount). The discount computed here is what we actually charge.
    let discountAmount = 0;
    let appliedCouponCode: string | null = null;
    if (body.couponCode && body.couponCode.trim()) {
      const result = await validateCoupon({
        code: body.couponCode,
        subtotal,
        customerPhone: body.customerPhone,
      });
      if (!result.valid) {
        // Reject the order so the customer can fix/remove the coupon
        // rather than silently charging full price.
        return fail(result.message, 400);
      }
      discountAmount = result.discountAmount;
      appliedCouponCode = result.coupon?.code ?? null;
    }

    // Shipping is charged on the after-discount amount (free at/above the
    // threshold). This is the binding amount the customer actually pays.
    const afterDiscount = Math.max(0, subtotal - discountAmount);
    const shippingCost =
      afterDiscount >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
    // Shipping/freight is taxable (CGST Act s.15) — add GST on it at the
    // order's rate (or 18% for a mixed-rate cart). Charge a whole-rupee
    // amount; the paise round-off shows on the invoice. shippingCost stays
    // ex-GST (the invoice adds the GST). Keep in sync with
    // computeOrderSummary().
    const orderRates = [...new Set(itemsToCreate.map((i) => i.taxPercent))];
    const shippingRate = orderRates.length === 1 ? orderRates[0] : 18;
    const totalAmount = Math.round(
      afterDiscount + shippingCost * (1 + shippingRate / 100),
    );
    const orderNumber = `KK${Date.now().toString(36).toUpperCase()}`;

    // Link the order to the logged-in account so it appears in "My Orders".
    // Verified against the DB first: an invalid id can NEVER break order
    // creation (no FK error) — it simply falls back to an unlinked order,
    // exactly the prior behaviour.
    let linkedCustomerId: number | null = null;
    if (body.customerId != null) {
      const acct = await prisma.customer.findUnique({
        where: { id: body.customerId },
        select: { id: true },
      });
      linkedCustomerId = acct?.id ?? null;
    }

    const order = await prisma.order.create({
      data: {
        orderNumber,
        customerId: linkedCustomerId,
        customerName: body.customerName,
        customerEmail: body.customerEmail || null,
        customerPhone: body.customerPhone,
        // B2B GST invoice: store only a well-formed GSTIN; drop anything else
        // so a bad value can never break order creation.
        customerGstin:
          body.customerGstin && GSTIN_RE.test(body.customerGstin.trim().toUpperCase())
            ? body.customerGstin.trim().toUpperCase()
            : null,
        shippingAddress: body.shippingAddress,
        subtotal,
        discountAmount,
        shippingCost,
        couponCode: appliedCouponCode,
        totalAmount,
        orderStatus: 'pending',
        paymentStatus: 'pending',
        items: { create: itemsToCreate },
      },
    });

    const amountPaise = Math.round(totalAmount * 100);
    const rz = await createRazorpayOrder(amountPaise, orderNumber);

    await prisma.order.update({
      where: { id: order.id },
      data: { razorpayOrderId: rz.id },
    });

    return ok({
      orderId: order.id,
      orderNumber,
      razorpayOrderId: rz.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
      amount: rz.amount,
      currency: rz.currency,
      subtotal,
      discountAmount,
      shippingCost,
      couponCode: appliedCouponCode,
      customerName: body.customerName,
      customerEmail: body.customerEmail || '',
      customerPhone: body.customerPhone,
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
