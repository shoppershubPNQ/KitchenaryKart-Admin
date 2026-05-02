import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';

const adjustSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int(),
  movementType: z.enum(['stock_in', 'stock_out', 'adjustment', 'damage']),
  notes: z.string().optional(),
});

/** Stock movements list. */
export const GET = withAuth(async (req) => {
  try {
    const url = new URL(req.url);
    const productId = url.searchParams.get('productId');
    const movements = await prisma.inventoryMovement.findMany({
      where: productId ? { productId: parseInt(productId) } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { product: { select: { sku: true, name: true } } },
    });
    return ok({ movements });
  } catch (e) {
    return handleError(e);
  }
});

/** Record a stock adjustment. */
export const POST = withAuth(async (req, { user }) => {
  try {
    const body = adjustSchema.parse(await req.json());
    const delta = body.movementType === 'stock_in' ? body.quantity
                : body.movementType === 'adjustment' ? body.quantity
                : -Math.abs(body.quantity);

    const [movement, product] = await prisma.$transaction([
      prisma.inventoryMovement.create({
        data: {
          productId: body.productId,
          movementType: body.movementType,
          quantity: body.quantity,
          notes: body.notes,
          createdById: user.id,
        },
      }),
      prisma.product.update({
        where: { id: body.productId },
        data: { stock: { increment: delta } },
      }),
    ]);

    return ok({ movement, product });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);
