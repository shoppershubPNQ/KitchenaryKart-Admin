import { PrismaClient, ProductStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();

interface RawProduct {
  sku: string;
  name: string;
  category: string;
  subcategory: string;
  leaf?: string;
  dimensions?: string;
  power?: string;
  capacity?: string;
  weight?: string;
  mrp?: number;
  price: number;
  hsn?: string;
  tax?: string | number;
  variant?: string;
  variantType?: string;
}

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@kitchenarykart.com';
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.adminUser.upsert({
    where: { email },
    update: {},
    create: {
      name: 'Admin',
      email,
      passwordHash,
      role: 'admin',
    },
  });
  console.log(`✓ Admin user: ${email} (password: ${password})`);
  return admin;
}

async function seedSettings() {
  const defaults: Array<{ key: string; value: string; dataType: string }> = [
    { key: 'company_name', value: 'KitchenaryKart', dataType: 'string' },
    { key: 'company_gst', value: '18AABCT1234B1Z5', dataType: 'string' },
    { key: 'default_tax_percent', value: '18', dataType: 'number' },
    { key: 'free_shipping_above', value: '10000', dataType: 'number' },
    { key: 'whatsapp_number', value: '+919890352455', dataType: 'string' },
    { key: 'support_email', value: 'support@kitchenarykart.com', dataType: 'string' },
  ];
  for (const s of defaults) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: {},
      create: s,
    });
  }
  console.log(`✓ ${defaults.length} settings`);
}

async function seedCategories(products: RawProduct[]) {
  const cats = [...new Set(products.map(p => p.category).filter(Boolean))];
  for (const name of cats) {
    const count = products.filter(p => p.category === name).length;
    await prisma.category.upsert({
      where: { name },
      update: { productCount: count },
      create: {
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        productCount: count,
      },
    });
  }
  console.log(`✓ ${cats.length} categories`);
}

async function seedProducts(products: RawProduct[], createdById: number) {
  console.log(`Importing ${products.length} products…`);
  const BATCH = 200;
  let inserted = 0;
  let skipped = 0;

  const existing = new Set(
    (await prisma.product.findMany({ select: { sku: true } })).map(p => p.sku)
  );

  for (let i = 0; i < products.length; i += BATCH) {
    const chunk = products.slice(i, i + BATCH);
    const rows = chunk
      .filter(p => p.sku && !existing.has(p.sku))
      .map(p => {
        existing.add(p.sku);
        return {
          sku: p.sku,
          name: p.name,
          category: p.category || null,
          subcategory: p.subcategory || null,
          leafCategory: p.leaf || null,
          price: p.price ?? 0,
          mrp: p.mrp ?? null,
          taxPercent: typeof p.tax === 'string' ? parseFloat(p.tax) || 18 : (p.tax ?? 18),
          dimensions: p.dimensions || null,
          power: p.power || null,
          capacity: p.capacity || null,
          weight: p.weight || null,
          hsnCode: p.hsn || null,
          stock: 100,
          status: ProductStatus.active,
          createdById,
        };
      });

    skipped += chunk.length - rows.length;
    if (rows.length) {
      const res = await prisma.product.createMany({ data: rows, skipDuplicates: true });
      inserted += res.count;
    }
    process.stdout.write(`  ${Math.min(i + BATCH, products.length)}/${products.length}\r`);
  }
  console.log(`\n✓ ${inserted} products inserted, ${skipped} skipped (duplicates)`);
}

async function main() {
  const jsonPath = path.resolve(__dirname, '../../website/products.json');
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`products.json not found at ${jsonPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as { products: RawProduct[] };

  const admin = await seedAdmin();
  await seedSettings();
  await seedCategories(raw.products);
  await seedProducts(raw.products, admin.id);

  console.log('\nSeed complete.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
