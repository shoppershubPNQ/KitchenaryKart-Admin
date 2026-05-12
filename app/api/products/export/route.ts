/**
 * GET /api/products/export
 *
 * Streams the full product table as an .xlsx download. Column headers match
 * the bulk-import schema exactly so an admin can:
 *   1. Click "Export" → save products.xlsx
 *   2. Edit any cells in Excel
 *   3. Upload via "Bulk import" → those SKUs get UPDATED (other SKUs untouched)
 *
 * To DELETE a product via this flow, do it in the UI — leaving a row out of
 * the import file does not delete; it just leaves that product alone.
 */
import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';

export const GET = withAuth(async (_req: NextRequest) => {
  const products = await prisma.product.findMany({
    orderBy: [{ category: 'asc' }, { subcategory: 'asc' }, { name: 'asc' }],
  });

  // Map camelCase DB fields → snake_case columns matching the import schema.
  // Column order matters here — it's the order they'll appear in Excel.
  const rows = products.map((p) => ({
    sku: p.sku,
    name: p.name,
    description: p.description ?? '',
    category: p.category ?? '',
    subcategory: p.subcategory ?? '',
    price: p.price ? Number(p.price) : 0,
    mrp: p.mrp ? Number(p.mrp) : '',
    tax_percent: p.taxPercent ? Number(p.taxPercent) : 18,
    hsn_code: p.hsnCode ?? '',
    stock: p.stock,
    reorder_point: p.reorderPoint,
    dimensions: p.dimensions ?? '',
    power: p.power ?? '',
    capacity: p.capacity ?? '',
    weight: p.weight ?? '',
    material: p.material ?? '',
    color: p.color ?? '',
    status: p.status,
    is_bestseller: p.isBestseller ? 'TRUE' : 'FALSE',
    is_new_arrival: p.isNewArrival ? 'TRUE' : 'FALSE',
    meta_keywords: p.metaKeywords ?? '',
    image_url: p.imageUrl ?? '',
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Products');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `products-export-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
