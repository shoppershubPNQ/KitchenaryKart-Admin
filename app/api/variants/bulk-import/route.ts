/**
 * Bulk variant import.
 *
 * POST /api/variants/bulk-import (multipart, field name: file)
 *
 * Expected columns (case-insensitive, both .csv and .xlsx supported):
 *
 *   sku           | required — Product SKU the variant belongs to
 *   variant_type  | required — e.g. "Size", "Color", "Power"
 *   variant_value | required — e.g. "Small", "Red", "1500W"
 *   sku_suffix    | optional — e.g. "-S", "-RED"
 *   price_modifier| optional — number added to base price (negative = discount)
 *   stock         | optional — integer; defaults to 0
 *
 * Each row creates one ProductVariant. Rows with unknown SKUs or missing
 * required fields are reported as failed but don't abort the import.
 */
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';

interface Row {
  sku?: string;
  variant_type?: string;
  variant_value?: string;
  sku_suffix?: string;
  price_modifier?: string | number;
  stock?: string | number;
  [k: string]: any;
}

function pick(row: Row, ...keys: string[]): any {
  for (const k of keys) {
    const v = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function toInt(v: unknown): number | null {
  const n = toNum(v);
  return n === null ? null : Math.trunc(n);
}

export const POST = withAuth(async (req) => {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return fail('No file uploaded');

    const buf = Buffer.from(await file.arrayBuffer());
    const name = file.name.toLowerCase();

    let rows: Row[] = [];
    if (name.endsWith('.csv')) {
      const text = buf.toString('utf8');
      const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
      rows = parsed.data;
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const wb = XLSX.read(buf, { type: 'buffer' });
      rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]]);
    } else {
      return fail('Unsupported file type. Use .csv or .xlsx');
    }

    // Resolve SKUs to product IDs in one query.
    const skus = Array.from(
      new Set(
        rows
          .map((r) => pick(r, 'sku', 'SKU', 'Sku'))
          .filter((s) => typeof s === 'string' && s.trim().length > 0)
          .map((s) => String(s).trim()),
      ),
    );
    const products = skus.length
      ? await prisma.product.findMany({
          where: { sku: { in: skus } },
          select: { id: true, sku: true },
        })
      : [];
    const skuToId = new Map(products.map((p) => [p.sku, p.id]));

    let inserted = 0;
    let failed = 0;
    const errors: { row: number; reason: string }[] = [];

    let i = 0;
    for (const r of rows) {
      i++;
      const sku = pick(r, 'sku', 'SKU', 'Sku');
      const variantType = pick(r, 'variant_type', 'variantType', 'VariantType', 'type');
      const variantValue = pick(r, 'variant_value', 'variantValue', 'VariantValue', 'value');

      if (!sku || !variantType || !variantValue) {
        failed++;
        errors.push({ row: i, reason: 'Missing sku / variant_type / variant_value' });
        continue;
      }
      const productId = skuToId.get(String(sku).trim());
      if (!productId) {
        failed++;
        errors.push({ row: i, reason: `Unknown product SKU: ${sku}` });
        continue;
      }

      try {
        await prisma.productVariant.create({
          data: {
            productId,
            variantType: String(variantType).trim(),
            variantValue: String(variantValue).trim(),
            skuSuffix: (pick(r, 'sku_suffix', 'skuSuffix') ?? null) || null,
            priceModifier: toNum(pick(r, 'price_modifier', 'priceModifier')) ?? 0,
            stock: toInt(pick(r, 'stock')) ?? 0,
          },
        });
        inserted++;
      } catch (e: any) {
        failed++;
        errors.push({ row: i, reason: e?.message || 'Insert failed' });
      }
    }

    return ok({ inserted, failed, total: rows.length, errors: errors.slice(0, 50) });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);
