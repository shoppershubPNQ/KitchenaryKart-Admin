import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { SpotlightForm } from '@/components/SpotlightForm';

export default async function EditSpotlightPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id);
  if (Number.isNaN(id)) notFound();
  const s = await prisma.spotlight.findUnique({ where: { id } });
  if (!s) notFound();

  return (
    <div className="space-y-4">
      <div>
        <Link href="/dashboard/spotlight" className="text-xs text-slate-500 hover:text-brand">← Back to Spotlight</Link>
        <h1 className="text-2xl font-semibold text-slate-900">
          {s.headline || <span className="text-slate-400 italic">/featured/{s.slug}</span>}
        </h1>
      </div>
      <SpotlightForm
        isNew={false}
        initial={{
          id: s.id,
          slug: s.slug,
          productSku: s.productSku,
          eyebrow: s.eyebrow,
          headline: s.headline,
          videoUrl: s.videoUrl,
          videoPoster: s.videoPoster,
          keyFeatures: (s.keyFeatures as string[]) ?? [],
          specifications: (s.specifications as { label: string; value: string }[]) ?? [],
          packagingIncludes: (s.packagingIncludes as string[]) ?? [],
          idealFor: (s.idealFor as string[]) ?? [],
          whyBuy: (s.whyBuy as { title: string; text: string }[]) ?? [],
          comparison: (s.comparison as { rows: { feature: string; kk: string; others: string }[] }) ?? { rows: [] },
          careDisposal: s.careDisposal,
          description: s.description,
          position: s.position,
          isActive: s.isActive,
        }}
      />
    </div>
  );
}
