import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BannerForm } from '@/components/BannerForm';

/**
 * New Banner 1 (hero) entry. If a `?placement=secondary` query slips in
 * (e.g. an old bookmark), redirect into the dedicated Banner 2 namespace
 * so the sidebar lights up the right item.
 */
export default function NewBannerPage({
  searchParams,
}: {
  searchParams?: { placement?: string };
}) {
  if (searchParams?.placement === 'secondary') {
    redirect('/dashboard/banners-2/new');
  }
  return (
    <div className="space-y-4">
      <div>
        <Link href="/dashboard/banners" className="text-xs text-slate-500 hover:text-brand">
          ← Back to Banner 1
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">New banner — Banner 1</h1>
      </div>

      <BannerForm
        isNew
        initial={{
          imageUrl: '',
          position: 0,
          isActive: true,
          placement: 'hero',
        }}
      />
    </div>
  );
}
