import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { revalidateWeb } from '@/lib/revalidateWeb';

const updateSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  price: z.number().nonnegative().optional(),
  costPrice: z.number().nonnegative().nullable().optional(),
  mrp: z.number().nonnegative().nullable().optional(),
  taxPercent: z.number().nonnegative().optional(),
  discountPercent: z.number().nonnegative().optional(),
  dimensions: z.string().nullable().optional(),
  power: z.string().nullable().optional(),
  capacity: z.string().nullable().optional(),
  weight: z.string().nullable().optional(),
  stock: z.number().int().nonnegative().optional(),
  reorderPoint: z.number().int().nonnegative().optional(),
  hsnCode: z.string().nullable().optional(),
  status: z.enum(['active', 'draft', 'discontinued']).optional(),
  imageUrl: z.string().url().nullable().optional(),
  images: z.array(z.string().url()).optional(),
  isBestseller: z.boolean().optional(),
  isNewArrival: z.boolean().optional(),
});

export const GET = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    const product = await prisma.product.findUnique({
      where: { id },
      include: { variants: true },
    });
    if (!product) return fail('Not found', 404);
    return ok({ product });
  } catch (e) {
    return handleError(e);
  }
});

export const PUT = withAuth(async (req, { params }) => {
  try {
    const id = parseInt(params.id);
    const body = updateSchema.parse(await req.json());
    const { images, ...rest } = body;
    const product = await prisma.product.update({
      where: { id },
      data: { ...rest, ...(images ? { images: images as any } : {}) },
    });
    await revalidateWeb('products');
    return ok({ product });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);

// Partial update — used by the products list page for one-click merchandising
// toggles (Best Seller / New Arrival). Shares the same validation schema as
// PUT; any subset of those fields is accepted.
export const PATCH = withAuth(async (req, { params }) => {
  try {
    const id = parseInt(params.id);
    const body = updateSchema.parse(await req.json());
    const { images, ...rest } = body;
    const product = await prisma.product.update({
      where: { id },
      data: { ...rest, ...(images ? { images: images as any } : {}) },
    });
    await revalidateWeb('products');
    return ok({ product });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);

export const DELETE = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    await prisma.product.delete({ where: { id } });
    await revalidateWeb('products');
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
