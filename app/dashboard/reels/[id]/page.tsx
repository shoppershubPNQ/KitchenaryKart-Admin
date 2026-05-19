import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { ReelForm } from '@/components/ReelForm';

export default async function EditReelPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id);
  if (Number.isNaN(id)) notFound();
  const r = await prisma.reel.findUnique({ where: { id } });
  if (!r) notFound();

  return (
    <div className="space-y-4">
      <div>
        <Link href="/dashboard/reels" className="text-xs text-slate-500 hover:text-brand">
          ← Back to Reels
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">
          {r.caption || <span className="text-slate-400 italic">Untitled reel</span>}
        </h1>
      </div>

      <ReelForm
        isNew={false}
        initial={{
          id: r.id,
          videoUrl: r.videoUrl,
          thumbnailUrl: r.thumbnailUrl,
          caption: r.caption,
          instagramUrl: r.instagramUrl,
          productSku: r.productSku,
          viewCount: r.viewCount,
          position: r.position,
          isActive: r.isActive,
        }}
      />
    </div>
  );
}
