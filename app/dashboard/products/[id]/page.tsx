import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { ProductForm } from '@/components/ProductForm';
import { ProductImages } from '@/components/ProductImages';
import { ProductVariants } from '@/components/ProductVariants';

export default async function EditProductPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id);
  if (Number.isNaN(id)) notFound();
  const p = await prisma.product.findUnique({ where: { id } });
  if (!p) notFound();

  return (
    // Full width, because the variants table below now carries ten columns
    // (price, mrp, weight, capacity, power, dimensions, stock…) and at the old
    // max-w-4xl they were pushed into a horizontal scroll — the price and stock
    // fields were simply off-screen. The images and the detail form stay capped
    // at a readable width; only the table is allowed to use the whole page.
    <div className="space-y-4">
      <div>
        <div className="text-xs font-mono text-slate-500">
          {p.sku}
          {p.productCode && <span className="text-slate-400"> · {p.productCode}</span>}
        </div>
        <h1 className="text-2xl font-semibold text-slate-900">{p.name}</h1>
      </div>

      <div className="max-w-5xl space-y-4">
      <ProductImages
        productId={p.id}
        sku={p.sku}
        imageUrl={p.imageUrl}
        images={(p.images as string[] | null) || []}
      />

      <ProductForm
        isNew={false}
        initial={{
          id: p.id,
          sku: p.sku,
          productCode: p.productCode,
          name: p.name,
          description: p.description,
          category: p.category,
          subcategory: p.subcategory,
          price: Number(p.price),
          costPrice: p.costPrice ? Number(p.costPrice) : null,
          mrp: p.mrp ? Number(p.mrp) : null,
          taxPercent: Number(p.taxPercent),
          dimensions: p.dimensions,
          power: p.power,
          capacity: p.capacity,
          weight: p.weight,
          stock: p.stock,
          reorderPoint: p.reorderPoint,
          hsnCode: p.hsnCode,
          status: p.status as any,
          isBestseller: p.isBestseller,
          isNewArrival: p.isNewArrival,
        }}
      />
      </div>

      <ProductVariants productId={p.id} />
    </div>
  );
}
