/**
 * GET /api/variants/template
 *
 * Sample .xlsx for bulk-importing product variants. Variants attach to an
 * existing Product by SKU — so make sure the parent SKU exists in the DB
 * before uploading variants.
 */
import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';

const SAMPLE_ROWS = [
  {
    sku: 'SAMPLE-001',
    variant_type: 'Size',
    variant_value: 'Small',
    sku_suffix: '-S',
    price_modifier: 0,
    stock: 25,
  },
  {
    sku: 'SAMPLE-001',
    variant_type: 'Size',
    variant_value: 'Medium',
    sku_suffix: '-M',
    price_modifier: 200,
    stock: 30,
  },
  {
    sku: 'SAMPLE-001',
    variant_type: 'Size',
    variant_value: 'Large',
    sku_suffix: '-L',
    price_modifier: 400,
    stock: 15,
  },
  {
    sku: 'SAMPLE-002',
    variant_type: 'Color',
    variant_value: 'Red',
    sku_suffix: '-RED',
    price_modifier: 0,
    stock: 50,
  },
  {
    sku: 'SAMPLE-002',
    variant_type: 'Color',
    variant_value: 'Blue',
    sku_suffix: '-BLU',
    price_modifier: 0,
    stock: 50,
  },
];

export async function GET(_req: NextRequest) {
  const sheet = XLSX.utils.json_to_sheet(SAMPLE_ROWS);
  sheet['!cols'] = [
    { wch: 14 }, // sku
    { wch: 14 }, // variant_type
    { wch: 14 }, // variant_value
    { wch: 14 }, // sku_suffix
    { wch: 14 }, // price_modifier
    { wch: 8 },  // stock
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Variants');

  const readme = XLSX.utils.aoa_to_sheet([
    ['Column', 'Required?', 'Notes'],
    ['sku', 'YES', 'The PARENT product\'s SKU. The product must already exist in the DB.'],
    ['variant_type', 'YES', 'The axis name, e.g. "Size", "Color", "Capacity", "Power".'],
    ['variant_value', 'YES', 'The value on that axis, e.g. "Small", "Red", "5.5L".'],
    ['sku_suffix', 'no', 'Appended to parent SKU to form the full child SKU. If blank, parent SKU is reused.'],
    ['price_modifier', 'no', 'INR added to parent price (negative = discount). 0 = same as parent.'],
    ['stock', 'no', 'Integer inventory for this variant. Defaults to 0.'],
    [],
    ['IMPORT BEHAVIOUR'],
    ['• Each row creates ONE variant linked to the parent SKU.'],
    ['• Existing variants matched by (parent_sku + variant_type + variant_value) are UPDATED.'],
    ['• Variants in DB not in this file are NOT deleted — bulk-import never deletes.'],
    ['• Use the admin UI to delete a variant.'],
  ]);
  readme['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, readme, 'README');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="variants-import-template.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
