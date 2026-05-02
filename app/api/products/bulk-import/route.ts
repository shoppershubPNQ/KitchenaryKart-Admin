import { NextRequest } from 'next/server';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';

interface Row {
  sku?: string;
  name?: string;
  category?: string;
  subcategory?: string;
  price?: string | number;
  mrp?: string | number;
  tax_percent?: string | number;
  dimensions?: string;
  power?: string;
  capacity?: string;
  weight?: string;
  stock?: string | number;
  hsn_code?: string;
}

export const POST = withAuth(async (req, { user }) => {
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

    let inserted = 0;
    let updated = 0;
    let failed = 0;

    for (const r of rows) {
      if (!r.sku || !r.name || r.price === undefined) {
        failed++;
        continue;
      }
      try {
        const data = {
          sku: String(r.sku).trim(),
          name: String(r.name).trim(),
          category: r.category ? String(r.category) : null,
          subcategory: r.subcategory ? String(r.subcategory) : null,
          price: toNum(r.price) ?? 0,
          mrp: toNum(r.mrp),
          taxPercent: toNum(r.tax_percent) ?? 18,
          dimensions: r.dimensions ? String(r.dimensions) : null,
          power: r.power ? String(r.power) : null,
          capacity: r.capacity ? String(r.capacity) : null,
          weight: r.weight ? String(r.weight) : null,
          stock: toInt(r.stock) ?? 0,
          hsnCode: r.hsn_code ? String(r.hsn_code) : null,
          createdById: user.id,
        };

        const existing = await prisma.product.findUnique({ where: { sku: data.sku } });
        if (existing) {
          await prisma.product.update({ where: { sku: data.sku }, data });
          updated++;
        } else {
          await prisma.product.create({ data });
          inserted++;
        }
      } catch (err) {
        console.error('Import row failed:', r.sku, err);
        failed++;
      }
    }

    return ok({ inserted, updated, failed, total: rows.length });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function toInt(v: unknown): number | null {
  const n = toNum(v);
  return n === null ? null : Math.trunc(n);
}
