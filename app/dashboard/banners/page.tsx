import { BannersList } from '@/components/BannersList';

/** Banner 1 — hero carousel slot at the top of the storefront home page. */
export default function HeroBannersPage() {
  return (
    <BannersList
      placement="hero"
      heading="Banner 1 — Hero carousel"
      description="Slides shown in the rotating hero on the storefront home page."
    />
  );
}
