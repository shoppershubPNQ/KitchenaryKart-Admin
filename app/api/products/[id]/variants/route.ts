/**
 * Variants for a single product.
 *
 * GET  /api/products/:id/variants — list (no auth pagination needed; small list)
 * POST /api/products/:id/variants — create one variant row
 *
 * Each variant is one (type, value) pair, e.g. {Size: "Small"} or
 * {Power: "1500W"}. To support multi-axis variants on one product, the admin
 * just adds multiple rows (Size: Small, Size: Medium, Color: Red, ...).
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';

const createSchema = z.object({
  variantType: z.string().min(1),
  variantValue: z.string().min(1),
  skuSuffix: z.string().nullable().optional(),
  priceModifier: z.number().optional(),
  price: z.number().nullable().optional(),
  mrp: z.number().nullable().optional(),
  stock: z.number().int().nonnegative().optional(),
});

export const GET = withAuth(async (_req, { params }) => {
  try {
    const productId = parseInt(params.id);
    const variants = await prisma.productVariant.findMany({
      where: { productId },
      orderBy: [{ variantType: 'asc' }, { variantValue: 'asc' }, { id: 'asc' }],
    });
    return ok({ variants });
  } catch (e) {
    return handleError(e);
  }
});

export const POST = withAuth(async (req, { params }) => {
  try {
    const productId = parseInt(params.id);
    const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) return fail('Product not found', 404);

    const body = createSchema.parse(await req.json());
    const variant = await prisma.productVariant.create({
      data: {
        productId,
        variantType: body.variantType,
        variantValue: body.variantValue,
        skuSuffix: body.skuSuffix ?? null,
        priceModifier: body.priceModifier ?? 0,
        price: body.price ?? null,
        mrp: body.mrp ?? null,
        stock: body.stock ?? 0,
      },
    });
    return ok({ variant }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);
