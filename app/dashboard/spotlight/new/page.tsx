import Link from 'next/link';
import { SpotlightForm } from '@/components/SpotlightForm';

export default function NewSpotlightPage() {
  return (
    <div className="space-y-4">
      <div>
        <Link href="/dashboard/spotlight" className="text-xs text-slate-500 hover:text-brand">← Back to Spotlight</Link>
        <h1 className="text-2xl font-semibold text-slate-900">New spotlight</h1>
      </div>
      <SpotlightForm isNew initial={{ slug: '', productSku: '', position: 0, isActive: true }} />
    </div>
  );
}
