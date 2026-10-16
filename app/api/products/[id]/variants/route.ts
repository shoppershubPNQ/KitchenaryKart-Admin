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
import { heSizePrice, isKept, readHeSizes, type HeSizePrice } from '@/lib/he-price-watch';

const createSchema = z.object({
  variantType: z.string().min(1),
  variantValue: z.string().min(1),
  skuSuffix: z.string().nullable().optional(),
  priceModifier: z.number().optional(),
  price: z.number().nullable().optional(),
  mrp: z.number().nullable().optional(),
  weight: z.string().trim().max(40).nullable().optional(),
  /** Per-variant specs; null = inherit the parent. */
  capacity: z.string().trim().max(80).nullable().optional(),
  power: z.string().trim().max(80).nullable().optional(),
  dimensions: z.string().trim().max(120).nullable().optional(),
  /** Per-variant description; null / empty = show the parent's. */
  description: z.string().trim().max(8000).nullable().optional(),
  stock: z.number().int().nonnegative().optional(),
});

export const GET = withAuth(async (_req, { params }) => {
  try {
    const productId = parseInt(params.id);
    const [variants, product, heSizes] = await Promise.all([
      prisma.productVariant.findMany({
        where: { productId },
        orderBy: [{ variantType: 'asc' }, { variantValue: 'asc' }, { id: 'asc' }],
      }),
      prisma.product.findUnique({ where: { id: productId }, select: { sku: true, price: true, taxPercent: true } }),
      readHeSizes(),
    ]);
    // HE's own price for each size, from the daily HE price check — keyed by variant id; a size HE does not
    // list (or prices at a different GST) is simply absent. Display only.
    const he: Record<number, HeSizePrice> = {};
    if (product && heSizes) {
      const gst = product.taxPercent == null ? 18 : Number(product.taxPercent);
      for (const v of variants) {
        if (!v.skuSuffix) continue;
        const ours = v.price != null ? Number(v.price) : Number(product.price) + Number(v.priceModifier ?? 0);
        const h = heSizePrice(heSizes.sizes[v.skuSuffix.toUpperCase()], gst, ours, isKept(v.skuSuffix, product.sku));
        if (h) he[v.id] = h;
      }
    }
    return ok({ variants, he });
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
        weight: body.weight ?? null,
        capacity: body.capacity ?? null,
        power: body.power ?? null,
        dimensions: body.dimensions ?? null,
        description: body.description || null,
        stock: body.stock ?? 0,
      },
    });
    return ok({ variant }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);
