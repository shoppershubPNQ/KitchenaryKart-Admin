import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok, paging } from '@/lib/api';
import { priceManualOrder, ManualOrderPricingError } from '@/lib/manual-order-pricing';

const itemSchema = z.object({
  productId: z.number().int().positive().optional(),
  sku: z.string().optional(),
  quantity: z.number().int().positive(),
  /**
   * Optional NEGOTIATED price override, GST-INCLUSIVE — the same basis as the
   * catalogue price. Unlike the storefront (where a client price is never
   * trusted) a phone order legitimately gets a agreed price, so an admin may
   * set one. Omit it and the DB price is used.
   */
  unitPrice: z.number().nonnegative().optional(),
  taxPercent: z.number().nonnegative().optional(),
});

const createSchema = z.object({
  customerId: z.number().int().positive().optional(),
  customerName: z.string().optional(),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().optional(),
  /** GSTIN entered at order time; the invoice prefers this over the profile's. */
  customerGstin: z.string().trim().optional(),
  shippingAddress: z.string().optional(),
  /**
   * Ex-GST freight override. OMIT IT to get the same zone x weight charge the
   * website would quote for this address and basket — that is the default and
   * the right answer nearly always.
   */
  shippingCost: z.number().nonnegative().optional(),
  /** GST-inclusive discount, in rupees. */
  discountAmount: z.number().nonnegative().optional(),
  notes: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

export const GET = withAuth(async (req) => {
  try {
    const url = new URL(req.url);
    const { limit, offset } = paging(url);
    const status = url.searchParams.get('status') || undefined;
    const paymentStatus = url.searchParams.get('paymentStatus') || undefined;
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    const search = url.searchParams.get('search')?.trim();

    const where: Prisma.OrderWhereInput = {};
    if (status) where.orderStatus = status as any;
    if (paymentStatus) where.paymentStatus = paymentStatus as any;
    if (dateFrom) where.createdAt = { ...(where.createdAt as any), gte: new Date(dateFrom) };
    if (dateTo) where.createdAt = { ...(where.createdAt as any), lte: new Date(dateTo) };
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
      ];
    }
    // Orders list = confirmed orders only. A storefront cart that reached
    // Razorpay but was never paid (orderStatus + paymentStatus both pending,
    // with a razorpayOrderId) is an abandoned cart, not an order — it lives on
    // the Abandoned Carts page instead. Excluded only from the default view;
    // an explicit status / paymentStatus filter still returns them so nothing
    // is truly hidden.
    if (!status && !paymentStatus) {
      where.NOT = {
        orderStatus: 'pending',
        paymentStatus: 'pending',
        razorpayOrderId: { not: null },
      };
    }

    const [items, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { items: true, customer: { select: { name: true, companyName: true } } },
      }),
      prisma.order.count({ where }),
    ]);

    return ok({ orders: items, total, limit, offset });
  } catch (e) {
    return handleError(e);
  }
});

export const POST = withAuth(async (req) => {
  try {
    const body = createSchema.parse(await req.json());

    let priced;
    try {
      priced = await priceManualOrder(body);
    } catch (e) {
      // A bad sku or empty basket is the operator's to fix — a 400 with the
      // reason, not a 500.
      if (e instanceof ManualOrderPricingError) return fail(e.message, 400);
      throw e;
    }
    const { lines, summary, shippingCost } = priced;

    const orderNumber = 'KK-' + Date.now().toString(36).toUpperCase();

    const order = await prisma.order.create({
      data: {
        orderNumber,
        customerId: body.customerId,
        customerName: body.customerName,
        customerEmail: body.customerEmail,
        customerPhone: body.customerPhone,
        customerGstin: body.customerGstin || null,
        shippingAddress: body.shippingAddress,
        shippingCost,
        // Stored GST-INCLUSIVE, exactly as the storefront stores it.
        subtotal: summary.netPrice + summary.lines.reduce((s, l) => s + l.lineGst, 0),
        discountAmount: summary.discountAmount,
        // The GST actually embedded in this order — goods GST on the discounted
        // value plus GST on freight. Never 18% bolted on top of an
        // already-inclusive price, which is what this route used to do.
        taxAmount: summary.gstAmount,
        totalAmount: summary.netPayable,
        notes: body.notes,
        items: {
          create: lines.map((r) => ({
            productId: r.productId ?? undefined,
            variantId: r.variantId ?? undefined,
            productName: r.productName,
            productSku: r.productSku,
            unitPrice: r.unitPrice,
            quantity: r.quantity,
            taxPercent: r.taxPercent,
            lineTotal: r.lineTotal,
          })),
        },
      },
      include: { items: true },
    });

    return ok({ order }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales']);
