import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { BannerForm } from '@/components/BannerForm';

export default async function EditBannerPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id);
  if (Number.isNaN(id)) notFound();
  const b = await prisma.banner.findUnique({ where: { id } });
  if (!b) notFound();

  // Bounce Banner 2 rows to their dedicated namespace so the sidebar
  // highlights the correct child item.
  if (b.placement === 'secondary') {
    redirect(`/dashboard/banners-2/${id}`);
  }

  const placement: 'hero' | 'secondary' = 'hero';
  const backHref = '/dashboard/banners';
  const backLabel = '← Back to Banner 1';

  return (
    <div className="space-y-4">
      <div>
        <Link href={backHref} className="text-xs text-slate-500 hover:text-brand">
          {backLabel}
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">
          {b.title || <span className="text-slate-400 italic">Untitled banner</span>}
        </h1>
      </div>

      <BannerForm
        isNew={false}
        initial={{
          id: b.id,
          placement,
          position: b.position,
          isActive: b.isActive,
          imageUrl: b.imageUrl,
          alt: b.alt,
          eyebrow: b.eyebrow,
          title: b.title,
          subtitle: b.subtitle,
          ctaText: b.ctaText,
          ctaHref: b.ctaHref,
          productSku: b.productSku,
          category: b.category,
        }}
      />
    </div>
  );
}
