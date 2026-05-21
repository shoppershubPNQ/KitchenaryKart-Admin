/**
 * Fire-and-forget cache-bust ping to the web storefront. Used after admin
 * mutations that affect cached storefront data (banners, categories, etc.).
 *
 * Silent on failure — we don't want an admin save to fail just because the
 * web server is down or the secret is misconfigured.
 */
export async function revalidateWeb(
  tag:
    | 'banners'
    | 'category-tree'
    | 'category-counts'
    | 'collections'
    | 'policies'
    | 'reels'
    | 'reviews'
    | 'social',
) {
  const base = process.env.WEB_BASE_URL || 'http://localhost:3001';
  const secret = process.env.REVALIDATE_SECRET || '';
  try {
    await fetch(`${base}/api/revalidate?tag=${encodeURIComponent(tag)}`, {
      method: 'POST',
      headers: secret ? { 'x-revalidate-secret': secret } : {},
      // Keep the connection short so the admin response isn't blocked.
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    /* intentional — non-critical */
  }
}
