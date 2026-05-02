import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok, paging } from '@/lib/api';

const createSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  leafCategory: z.string().optional(),
  price: z.number().nonnegative(),
  mrp: z.number().nonnegative().optional(),
  taxPercent: z.number().nonnegative().optional(),
  discountPercent: z.number().nonnegative().optional(),
  dimensions: z.string().optional(),
  power: z.string().optional(),
  capacity: z.string().optional(),
  weight: z.string().optional(),
  material: z.string().optional(),
  color: z.string().optional(),
  stock: z.number().int().nonnegative().optional(),
  reorderPoint: z.number().int().nonnegative().optional(),
  hsnCode: z.string().optional(),
  status: z.enum(['active', 'draft', 'discontinued']).optional(),
  imageUrl: z.string().url().optional(),
  images: z.array(z.string().url()).optional(),
  isBestseller: z.boolean().optional(),
  isNewArrival: z.boolean().optional(),
});

export const GET = withAuth(async (req) => {
  try {
    const url = new URL(req.url);
    const { limit, offset } = paging(url);
    const category = url.searchParams.get('category') || undefined;
    const status = url.searchParams.get('status') || undefined;
    const search = url.searchParams.get('search')?.trim();
    const lowStock = url.searchParams.get('lowStock') === '1';

    const where: Prisma.ProductWhereInput = {};
    if (category) where.category = category;
    if (status) where.status = status as any;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (lowStock) {
      // Use raw comparison — Prisma doesn't support column-to-column compares
      const ids = await prisma.$queryRaw<{ id: number }[]>`
        SELECT id FROM products WHERE stock <= reorder_point
      `;
      where.id = { in: ids.map(x => x.id) };
    }

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.product.count({ where }),
    ]);

    return ok({ products: items, total, limit, offset });
  } catch (e) {
    return handleError(e);
  }
});

export const POST = withAuth(async (req, { user }) => {
  try {
    const body = createSchema.parse(await req.json());
    const { images, ...rest } = body;
    const product = await prisma.product.create({
      data: {
        ...rest,
        images: images as any,
        createdById: user.id,
      },
    });
    return ok({ product }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);
