/**
 * GET /api/public/reels
 *
 * Storefront-facing feed of active reels, ordered by position. Joined with
 * the corresponding Product when productSku is set so the storefront can
 * render the small product row under each reel card without a second
 * round-trip per reel.
 *
 * CORS: open (same policy as /api/public/products) so the storefront and
 * any future static site can consume it.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  try {
    const reels = await prisma.reel.findMany({
      where: { isActive: true },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });

    const skus = reels.map((r) => r.productSku).filter((s): s is string => !!s);
    const products = skus.length
      ? await prisma.product.findMany({
          where: { sku: { in: skus } },
          select: {
            sku: true,
            name: true,
            price: true,
            imageUrl: true,
          },
        })
      : [];
    const productBySku = new Map(products.map((p) => [p.sku, p]));

    const payload = reels.map((r) => {
      const product = r.productSku ? productBySku.get(r.productSku) : undefined;
      return {
        id: r.id,
        videoUrl: r.videoUrl,
        thumbnailUrl: r.thumbnailUrl,
        caption: r.caption,
        instagramUrl: r.instagramUrl,
        productSku: r.productSku,
        viewCount: r.viewCount,
        position: r.position,
        product: product
          ? {
              sku: product.sku,
              name: product.name,
              price: Number(product.price),
              imageUrl: product.imageUrl,
            }
          : null,
      };
    });

    return NextResponse.json(
      { reels: payload },
      {
        headers: {
          ...CORS,
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      },
    );
  } catch (e) {
    return handleError(e);
  }
}
