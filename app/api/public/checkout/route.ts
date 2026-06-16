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

const schema = z.object({
  customerName: z.string().min(1),
  customerEmail: z.string().email().optional().or(z.literal('')),
  customerPhone: z.string().min(1),
  shippingAddress: z.string().min(1),
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
    const totalAmount = afterDiscount + shippingCost;
    const orderNumber = `KK${Date.now().toString(36).toUpperCase()}`;

    const order = await prisma.order.create({
      data: {
        orderNumber,
        customerName: body.customerName,
        customerEmail: body.customerEmail || null,
        customerPhone: body.customerPhone,
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
