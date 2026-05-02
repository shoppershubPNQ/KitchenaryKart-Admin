import { ProductForm } from '@/components/ProductForm';

export default function NewProductPage() {
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">New product</h1>
      <ProductForm
        isNew
        initial={{
          sku: '',
          name: '',
          price: 0,
          taxPercent: 18,
          status: 'active',
          stock: 100,
          reorderPoint: 5,
        }}
      />
    </div>
  );
}
