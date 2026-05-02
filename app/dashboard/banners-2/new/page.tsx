import Link from 'next/link';
import { BannerForm } from '@/components/BannerForm';

/** New Banner 2 (PromoCarousel slide). */
export default function NewBanner2Page() {
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
          New banner — Banner 2
        </h1>
      </div>

      <BannerForm
        isNew
        initial={{
          imageUrl: '',
          position: 0,
          isActive: true,
          placement: 'secondary',
        }}
      />
    </div>
  );
}
