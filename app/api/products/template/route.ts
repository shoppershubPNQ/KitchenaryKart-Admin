/**
 * GET /api/products/template
 *
 * Returns a sample .xlsx with the import column headers plus two example
 * rows that demonstrate every supported field. Admin downloads this as a
 * starting point for creating new product listings via bulk-import.
 *
 * Note: rows in the import file are matched by SKU. An existing SKU
 * UPDATES that product; a new SKU CREATES a new product. Leaving a SKU
 * out of the file does NOT delete the product — bulk-import never deletes.
 */
import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';

const SAMPLE_ROWS = [
  {
    sku: 'SAMPLE-001',
    name: 'Electric Bain Marie 3-Compartment',
    description: 'Stainless steel commercial bain marie with 3 GN pans. Wattage 1000W, 220V single-phase.',
    category: 'HOT EQUIPMENT',
    subcategory: 'BAIN MARIE',
    price: 12500,
    mrp: 25000,
    tax_percent: 18,
    hsn_code: '84189900',
    stock: 50,
    reorder_point: 5,
    dimensions: '900 x 550 x 250mm',
    power: '1000W',
    capacity: '3 x 5.5L',
    weight: '12kg',
    material: 'Stainless steel 304',
    color: '',
    status: 'active',
    is_bestseller: 'FALSE',
    is_new_arrival: 'TRUE',
    meta_keywords: 'bain marie, commercial, restaurant, hotel, buffet, food warmer',
    image_url: '',
  },
  {
    sku: 'SAMPLE-002',
    name: 'Silicon Baking Mat',
    description: 'Non-stick reusable silicon baking mat, food-grade.',
    category: 'ACCESSORIES',
    subcategory: 'BAKING MAT',
    price: 384,
    mrp: 767,
    tax_percent: 18,
    hsn_code: '39241090',
    stock: 200,
    reorder_point: 10,
    dimensions: '600 x 400mm',
    power: '',
    capacity: '',
    weight: '320g',
    material: 'Food-grade silicon',
    color: 'Red',
    status: 'active',
    is_bestseller: 'TRUE',
    is_new_arrival: 'FALSE',
    meta_keywords: 'silicon, baking, mat, bakery, non-stick, reusable',
    image_url: '',
  },
];

export async function GET(_req: NextRequest) {
  const sheet = XLSX.utils.json_to_sheet(SAMPLE_ROWS);

  // Add column-width hints so the file opens readably in Excel
  sheet['!cols'] = [
    { wch: 14 }, // sku
    { wch: 36 }, // name
    { wch: 50 }, // description
    { wch: 18 }, // category
    { wch: 18 }, // subcategory
    { wch: 10 }, // price
    { wch: 10 }, // mrp
    { wch: 12 }, // tax_percent
    { wch: 12 }, // hsn_code
    { wch: 8 },  // stock
    { wch: 14 }, // reorder_point
    { wch: 22 }, // dimensions
    { wch: 12 }, // power
    { wch: 12 }, // capacity
    { wch: 12 }, // weight
    { wch: 22 }, // material
    { wch: 10 }, // color
    { wch: 10 }, // status
    { wch: 14 }, // is_bestseller
    { wch: 14 }, // is_new_arrival
    { wch: 50 }, // meta_keywords
    { wch: 30 }, // image_url
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Products');

  // Also add a README sheet explaining the columns + import behaviour.
  const readme = XLSX.utils.aoa_to_sheet([
    ['Column', 'Required?', 'Notes'],
    ['sku', 'YES', 'Unique identifier. Existing SKU = updates that product. New SKU = creates new.'],
    ['name', 'YES', 'Product display name shown on the storefront.'],
    ['price', 'YES', 'Selling price in INR (GST-inclusive). No commas, no symbols.'],
    ['description', 'no', 'Long description, shown on product page.'],
    ['category', 'no', 'Top-level category. Used for shop filter.'],
    ['subcategory', 'no', 'Sub-grouping under category.'],
    ['mrp', 'no', 'Strike-through MRP. If empty, no discount badge shown.'],
    ['tax_percent', 'no', 'GST % (default 18 if blank).'],
    ['hsn_code', 'no', 'HSN code for GST invoicing.'],
    ['stock', 'no', 'Integer inventory count (default 0).'],
    ['reorder_point', 'no', 'Low-stock alert threshold (default 5).'],
    ['dimensions', 'no', 'Free-text size, e.g. "600 x 400 x 250mm".'],
    ['power', 'no', 'Free-text power rating, e.g. "1500W / 220V".'],
    ['capacity', 'no', 'Free-text capacity, e.g. "5.5L".'],
    ['weight', 'no', 'Free-text weight, e.g. "12kg".'],
    ['material', 'no', 'Free-text material, e.g. "Stainless steel 304".'],
    ['color', 'no', 'Free-text color.'],
    ['status', 'no', 'active | inactive | discontinued (default active).'],
    ['is_bestseller', 'no', 'TRUE / FALSE — shows on homepage Bestsellers strip.'],
    ['is_new_arrival', 'no', 'TRUE / FALSE — shows on homepage New Arrivals strip.'],
    ['meta_keywords', 'no', 'Comma-separated SEO keywords (improves search visibility).'],
    ['image_url', 'no', 'Path or full URL to the product image.'],
    [],
    ['IMPORT BEHAVIOUR'],
    ['• Same SKU in file as existing in DB → that product is UPDATED.'],
    ['• New SKU → product is CREATED.'],
    ['• SKU in DB but NOT in file → product is LEFT ALONE (never deleted).'],
    ['• To delete a product, use the admin UI directly.'],
  ]);
  readme['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, readme, 'README');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="products-import-template.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
