import { NextRequest } from 'next/server';
import { fail, handleError } from '@/lib/api';
import { buildInvoicePdfForOrder } from '@/lib/invoice-build';

/**
 * Internal invoice PDF endpoint for the storefront.
 *
 * NOT for browsers: it's guarded by a shared secret (`INTERNAL_API_SECRET`)
 * that only the storefront server knows, sent in the `x-internal-secret`
 * header. The storefront authenticates the customer and verifies order
 * ownership BEFORE calling this; we additionally re-check that the requested
 * order belongs to the claimed customer as defence-in-depth.
 *
 * Query params: orderNumber (required), customerId (optional ownership check).
 */
export async function GET(req: NextRequest) {
  try {
    const secret = process.env.INTERNAL_API_SECRET;
    // Fail closed: if the secret isn't configured, deny rather than allow.
    if (!secret || req.headers.get('x-internal-secret') !== secret) {
      return fail('Unauthorized', 401);
    }

    const { searchParams } = new URL(req.url);
    const orderNumber = searchParams.get('orderNumber');
    const customerId = searchParams.get('customerId');
    if (!orderNumber) return fail('orderNumber required', 400);

    const built = await buildInvoicePdfForOrder({ orderNumber });
    if (!built) return fail('Not found', 404);

    // Ownership re-check: if a customerId was supplied and the order has an
    // owner, they must match. (Guest/legacy orders have customerId = null.)
    if (customerId && built.customerId != null && String(built.customerId) !== customerId) {
      return fail('Forbidden', 403);
    }

    // Cast to BodyInit: a Uint8Array is a valid Response body at runtime, but
    // under TS 5.7+ Uint8Array<ArrayBufferLike> isn't assignable to BodyInit
    // (which wants an ArrayBuffer-backed view). Purely a types-lib quirk.
    return new Response(built.pdf as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="invoice-${built.orderNumber}.pdf"`,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
