import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok, paging } from '@/lib/api';

const itemSchema = z.object({
  productId: z.number().int().positive().optional(),
  sku: z.string().optional(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative().optional(),
  taxPercent: z.number().nonnegative().optional(),
});

const createSchema = z.object({
  customerId: z.number().int().positive().optional(),
  customerName: z.string().optional(),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().optional(),
  shippingAddress: z.string().optional(),
  shippingCost: z.number().nonnegative().optional(),
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

    // Resolve items from productId / sku
    const resolved: Array<{ productId: number | null; productName: string; productSku: string; unitPrice: number; quantity: number; taxPercent: number; lineTotal: number }> = [];
    for (const it of body.items) {
      let product = null as Awaited<ReturnType<typeof prisma.product.findUnique>>;
      if (it.productId) {
        product = await prisma.product.findUnique({ where: { id: it.productId } });
      } else if (it.sku) {
        product = await prisma.product.findUnique({ where: { sku: it.sku } });
      }
      const unitPrice = it.unitPrice ?? (product ? Number(product.price) : 0);
      const taxPercent = it.taxPercent ?? (product ? Number(product.taxPercent) : 18);
      resolved.push({
        productId: product?.id ?? null,
        productName: product?.name ?? 'Unknown item',
        productSku: product?.sku ?? (it.sku || ''),
        unitPrice,
        quantity: it.quantity,
        taxPercent,
        lineTotal: unitPrice * it.quantity,
      });
    }

    const subtotal = resolved.reduce((s, r) => s + r.lineTotal, 0);
    const tax = resolved.reduce((s, r) => s + (r.lineTotal * r.taxPercent) / 100, 0);
    const shipping = body.shippingCost ?? 0;
    const total = subtotal + tax + shipping;

    const orderNumber = 'KK-' + Date.now().toString(36).toUpperCase();

    const order = await prisma.order.create({
      data: {
        orderNumber,
        customerId: body.customerId,
        customerName: body.customerName,
        customerEmail: body.customerEmail,
        customerPhone: body.customerPhone,
        shippingAddress: body.shippingAddress,
        shippingCost: shipping,
        subtotal,
        taxAmount: tax,
        totalAmount: total,
        notes: body.notes,
        items: {
          create: resolved.map(r => ({
            productId: r.productId ?? undefined,
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
