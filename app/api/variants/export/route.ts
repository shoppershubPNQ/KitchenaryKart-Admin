/**
 * GET /api/variants/export
 *
 * Streams every product variant as an .xlsx, joined to the parent SKU.
 * Re-uploading this file via /dashboard/variants/import will UPDATE
 * variants matched by sku + variant_value (the existing bulk-import logic).
 */
import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';

export const GET = withAuth(async (_req: NextRequest) => {
  const variants = await prisma.productVariant.findMany({
    include: { product: { select: { sku: true, name: true } } },
    orderBy: [{ productId: 'asc' }, { id: 'asc' }],
  });

  const rows = variants.map((v) => ({
    parent_sku: v.product.sku,
    parent_name: v.product.name,
    variant_type: v.variantType ?? '',
    variant_value: v.variantValue ?? '',
    sku_suffix: v.skuSuffix ?? '',
    price_modifier: v.priceModifier ? Number(v.priceModifier) : 0,
    stock: v.stock,
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Variants');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `variants-export-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
