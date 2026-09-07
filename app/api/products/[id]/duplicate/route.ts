/**
 * POST /api/products/:id/duplicate — a new listing copied from this one.
 *
 * For the family that needs one more member, or the same goods under a
 * second SKU: every descriptive field comes across (name, description,
 * categories, pricing, GST, specs, SEO, FAQs), the pictures by URL when asked
 * (one Cloudinary account — nothing is re-uploaded), and the variants when
 * asked. What does NOT come across, on purpose:
 *
 *   stock           0 on the copy and its variants — the goods are counted once
 *   status          draft unless told otherwise, so nothing goes live by accident
 *   merchandising   Best Seller / New Arrival are earned, not inherited
 *   sync links      a copy is authored here, whatever the original was
 *   partner ids     a variant's external_id names the partner's row, not ours
 *
 * Variant SKUs: this catalogue keeps a FULL sku in `skuSuffix` (all 1,037
 * rows start with "KK"). A suffix that starts with the old parent sku is
 * re-based on the new one (`OLD-34` → `NEW-34`); any other full sku gets the
 * new parent in front so it cannot collide with the original's; a short
 * suffix ("RED") is kept — the feed composes it under the new parent.
 *
 * Body: { sku, name?, status?: 'draft'|'active', withVariants?, withImages? }
 */
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { invalidateAdminSearchIndex } from '@/lib/product-search-index';

const schema = z.object({
  sku: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['draft', 'active']).optional(),
  withVariants: z.boolean().optional(),
  withImages: z.boolean().optional(),
});

function makeProductCode(id: number): string {
  return `PID-${String(id).padStart(5, '0')}`;
}

function rebaseSuffix(suffix: string | null, oldSku: string, newSku: string): string | null {
  const s = (suffix ?? '').trim();
  if (s === '') return null;
  if (s.toLowerCase().startsWith(oldSku.toLowerCase())) return newSku + s.slice(oldSku.length);
  if (s.includes('-')) return `${newSku}-${s}`;
  return s;
}

export const POST = withAuth(async (req, { params, user }) => {
  try {
    const id = parseInt(params.id);
    const body = schema.parse(await req.json());
    const withVariants = body.withVariants ?? true;
    const withImages = body.withImages ?? true;

    const source = await prisma.product.findUnique({
      where: { id },
      include: { variants: { orderBy: { id: 'asc' } } },
    });
    if (!source) return fail('Product not found', 404);

    const sku = body.sku;
    if (sku.toLowerCase() === source.sku.toLowerCase()) return fail('Give the copy a different SKU', 400);
    const taken = await prisma.product.findFirst({
      where: { sku: { equals: sku, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (taken) return fail(`SKU "${sku}" already belongs to "${taken.name}"`, 409);

    const copy = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          sku,
          name: body.name ?? `${source.name} (copy)`,
          description: source.description,
          category: source.category,
          subcategory: source.subcategory,
          leafCategory: source.leafCategory,
          price: source.price,
          costPrice: source.costPrice,
          mrp: source.mrp,
          taxPercent: source.taxPercent,
          discountPercent: source.discountPercent,
          dimensions: source.dimensions,
          power: source.power,
          capacity: source.capacity,
          weight: source.weight,
          material: source.material,
          color: source.color,
          freeShipping: source.freeShipping,
          stock: 0,
          reorderPoint: source.reorderPoint,
          hsnCode: source.hsnCode,
          status: body.status ?? 'draft',
          isBestseller: false,
          isNewArrival: false,
          imageUrl: withImages ? source.imageUrl : null,
          images: withImages && source.images !== null ? (source.images as Prisma.InputJsonValue) : undefined,
          faqs: source.faqs !== null ? (source.faqs as Prisma.InputJsonValue) : undefined,
          metaTitle: source.metaTitle,
          metaDescription: source.metaDescription,
          metaKeywords: source.metaKeywords,
          createdById: user.id,
        },
      });
      await tx.product.update({ where: { id: created.id }, data: { productCode: makeProductCode(created.id) } });

      let variants = 0;
      if (withVariants) {
        for (const v of source.variants) {
          await tx.productVariant.create({
            data: {
              productId: created.id,
              variantType: v.variantType,
              variantValue: v.variantValue,
              skuSuffix: rebaseSuffix(v.skuSuffix, source.sku, sku),
              priceModifier: v.priceModifier,
              price: v.price,
              mrp: v.mrp,
              weight: v.weight,
              freeShipping: v.freeShipping,
              capacity: v.capacity,
              power: v.power,
              dimensions: v.dimensions,
              stock: 0,
              imageUrl: withImages ? v.imageUrl : null,
              images: withImages && v.images !== null ? (v.images as Prisma.InputJsonValue) : undefined,
            },
          });
          variants += 1;
        }
      }
      return { id: created.id, sku, variants };
    });

    invalidateAdminSearchIndex();
    return ok(
      {
        product: { id: copy.id, sku: copy.sku },
        variants: copy.variants,
        message: `Created ${copy.sku} as a ${body.status ?? 'draft'}${copy.variants ? ` with ${copy.variants} variant(s)` : ''}. Stock starts at 0.`,
      },
      { status: 201 },
    );
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);
