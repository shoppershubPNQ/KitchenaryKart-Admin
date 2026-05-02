import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';

export const GET = withAuth(async () => {
  try {
    const rows = await prisma.$queryRaw<Array<{
      id: number; sku: string; name: string; category: string | null; stock: number; reorder_point: number;
    }>>`
      SELECT id, sku, name, category, stock, reorder_point
      FROM products
      WHERE stock <= reorder_point AND status = 'active'
      ORDER BY (reorder_point - stock) DESC
      LIMIT 50
    `;
    return ok({
      items: rows.map(r => ({
        id: r.id, sku: r.sku, name: r.name, category: r.category,
        stock: r.stock, reorderPoint: r.reorder_point,
        unitsNeeded: r.reorder_point - r.stock,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
});
