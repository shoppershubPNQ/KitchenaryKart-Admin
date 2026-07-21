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
    | 'products'
    | 'reels'
    | 'reviews'
    | 'social'
    | 'spotlight',
) {
  // Base URL of the storefront to ping. Prefer WEB_BASE_URL, but in production
  // fall back to the live storefront (NOT localhost) so a missing/mis-set env
  // var can't silently break storefront cache-busting — the cause of banner /
  // content edits not showing until the 5-min ISR window. localhost stays the
  // dev default.
  const base =
    process.env.WEB_BASE_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://kitchenarykart.com'
      : 'http://localhost:3001');
  const secret = process.env.REVALIDATE_SECRET || '';
  try {
    await fetch(`${base}/api/revalidate?tag=${encodeURIComponent(tag)}`, {
      method: 'POST',
      headers: secret ? { 'x-revalidate-secret': secret } : {},
      // Awaited (Vercel cancels un-awaited fetches after the response). Allow a
      // little headroom for a cold-start on the web function so the ping isn't
      // dropped, without blocking the admin save for long.
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    /* intentional — non-critical */
  }
}
