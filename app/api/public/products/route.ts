import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { handleError, ok } from '@/lib/api';

/** Read-only product feed used by the public website. Matches the shape of products.json. */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const category = url.searchParams.get('category') || undefined;
    const search = url.searchParams.get('q')?.trim();

    const where: Prisma.ProductWhereInput = { status: 'active' };
    if (category) where.category = category;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { subcategory: { contains: search, mode: 'insensitive' } },
      ];
    }

    const rows = await prisma.product.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        sku: true,
        name: true,
        category: true,
        subcategory: true,
        leafCategory: true,
        dimensions: true,
        power: true,
        capacity: true,
        weight: true,
        mrp: true,
        price: true,
        hsnCode: true,
        taxPercent: true,
        imageUrl: true,
        images: true,
      },
    });

    // Map back to the legacy products.json shape so the existing website JS works unchanged.
    const products = rows.map(p => ({
      sku: p.sku,
      name: p.name,
      category: p.category,
      subcategory: p.subcategory,
      leaf: p.leafCategory,
      dimensions: p.dimensions,
      power: p.power,
      capacity: p.capacity,
      weight: p.weight,
      mrp: p.mrp ? Number(p.mrp) : null,
      price: Number(p.price),
      hsn: p.hsnCode,
      tax: String(p.taxPercent),
      imageUrl: p.imageUrl,
      images: (p.images as string[] | null) || [],
    }));

    return ok({ products });
  } catch (e) {
    return handleError(e);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
