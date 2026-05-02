import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { BannerForm } from '@/components/BannerForm';

/**
 * Banner 2 edit page. If the row turns out to be a Banner 1 (hero) entry —
 * e.g. the admin pasted the wrong URL — redirect to the matching Banner 1
 * editor instead of rendering it under the wrong section.
 */
export default async function EditBanner2Page({
  params,
}: {
  params: { id: string };
}) {
  const id = parseInt(params.id);
  if (Number.isNaN(id)) notFound();
  const b = await prisma.banner.findUnique({ where: { id } });
  if (!b) notFound();
  if (b.placement !== 'secondary') {
    redirect(`/dashboard/banners/${id}`);
  }

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/dashboard/banners-2"
          className="text-xs text-slate-500 hover:text-brand"
        >
          ← Back to Banner 2
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">
          {b.title || <span className="text-slate-400 italic">Untitled banner</span>}
        </h1>
      </div>

      <BannerForm
        isNew={false}
        initial={{
          id: b.id,
          placement: 'secondary',
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
