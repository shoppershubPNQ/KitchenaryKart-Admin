import Link from 'next/link';
import { ReelForm } from '@/components/ReelForm';

export default function NewReelPage() {
  return (
    <div className="space-y-4">
      <div>
        <Link href="/dashboard/reels" className="text-xs text-slate-500 hover:text-brand">
          ← Back to Reels
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">New reel</h1>
      </div>

      <ReelForm
        isNew
        initial={{
          videoUrl: '',
          position: 0,
          isActive: true,
          viewCount: 0,
        }}
      />
    </div>
  );
}
