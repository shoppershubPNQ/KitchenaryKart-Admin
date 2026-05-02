import { BannersList } from '@/components/BannersList';

/**
 * Banner 2 — secondary banner slot. Independent of the hero carousel; can be
 * mounted anywhere on the storefront once a frontend slot is wired for it.
 */
export default function SecondaryBannersPage() {
  return (
    <BannersList
      placement="secondary"
      heading="Banner 2 — Secondary slot"
      description="Independent banner slot, separate from the hero carousel."
    />
  );
}
