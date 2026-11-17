/**
 * Product photos for an invoice's lines (owner 2026-11-17: "product ki images
 * invoice mein kyu nahi aa rahi" → yes, add them to the admin "Download
 * invoice" PDF). The proforma (PI) scripts already print them; this brings the
 * same thumbnail to the order invoice.
 *
 * Each line gets the photo of the exact size bought (variant imageUrl, else its
 * first image), falling back to the listing's main photo. Cloudinary returns it
 * small, as a JPEG padded to a white square, so PDFKit can embed it directly
 * (no image processing in the function). A missing photo, a deleted file (HE
 * shares the Cloudinary account and sometimes deletes), a slow fetch or a
 * format PDFKit cannot read all give `null` — that line simply has no photo and
 * the invoice still renders.
 */
import { prisma } from './db';

const CLOUD = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD || 'ddvay7jt0';
const HOST = `https://res.cloudinary.com/${CLOUD}/image/upload`;
/** 200 px is plenty for a 50 pt thumbnail, and keeps each fetch ~10 KB. */
const T = 'f_jpg,q_80,c_pad,b_white,w_200,h_200';
const FETCH_TIMEOUT_MS = 4000;

/** Same URL rules as web/lib/format.ts imgSrc: a full Cloudinary URL gets the
 *  transform (chained after any it already has); a legacy /images/<file> path
 *  maps to the kk/ folder. Anything else (not Cloudinary) is used as is. */
export function invoicePhotoUrl(url: string): string {
  if (/^https?:/i.test(url)) {
    const marker = '/image/upload/';
    const at = url.indexOf(marker);
    if (at === -1) return url;
    return `${url.slice(0, at + marker.length)}${T}/${url.slice(at + marker.length)}`;
  }
  const m = url.match(/^\/?images\/(.+)$/i);
  return m ? `${HOST}/${T}/kk/${m[1]}` : url;
}

const firstImage = (imageUrl: string | null, images: unknown): string | null =>
  imageUrl || (Array.isArray(images) && typeof images[0] === 'string' ? (images[0] as string) : null) || null;

async function fetchPhoto(url: string): Promise<Buffer | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(invoicePhotoUrl(url), { signal: ctrl.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // PDFKit embeds JPEG and PNG only — check the bytes, not the header.
    const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    return jpeg || png ? buf : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** One photo (or null) per item, in the items' order — pass straight to the
 *  invoice renderer as `lineImages`. All fetched in parallel. */
export async function invoiceLinePhotos(
  items: Array<{ productId: number | null; variantId: number | null }>,
): Promise<Array<Buffer | null>> {
  const variantIds = [...new Set(items.map((i) => i.variantId).filter((v): v is number => v != null))];
  const productIds = [...new Set(items.map((i) => i.productId).filter((p): p is number => p != null))];
  const [variants, products] = await Promise.all([
    variantIds.length
      ? prisma.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, productId: true, imageUrl: true, images: true } })
      : Promise.resolve([]),
    productIds.length
      ? prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, imageUrl: true, images: true } })
      : Promise.resolve([]),
  ]);
  const vMap = new Map(variants.map((v) => [v.id, v]));
  const pMap = new Map(products.map((p) => [p.id, p]));
  // A variant line may have no productId on the order item: reach the listing through the variant.
  const missingParents = [...new Set(variants.map((v) => v.productId).filter((id) => !pMap.has(id)))];
  if (missingParents.length) {
    const more = await prisma.product.findMany({ where: { id: { in: missingParents } }, select: { id: true, imageUrl: true, images: true } });
    for (const p of more) pMap.set(p.id, p);
  }

  const urls = items.map((it) => {
    const v = it.variantId != null ? vMap.get(it.variantId) : undefined;
    const p = pMap.get(it.productId ?? v?.productId ?? -1);
    return (v && firstImage(v.imageUrl, v.images)) || (p && firstImage(p.imageUrl, p.images)) || null;
  });
  // The same photo on several lines is fetched once.
  const unique = [...new Set(urls.filter((u): u is string => !!u))];
  const fetched = new Map(await Promise.all(unique.map(async (u) => [u, await fetchPhoto(u)] as const)));
  return urls.map((u) => (u ? fetched.get(u) ?? null : null));
}
