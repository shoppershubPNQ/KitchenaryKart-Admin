import { withAuth } from '@/lib/auth';
import { fail, handleError } from '@/lib/api';
import { buildInvoicePdfForOrder } from '@/lib/invoice-build';

/**
 * Admin-only invoice PDF. The data assembly + rendering lives in
 * lib/invoice-build.ts so the internal storefront route (secret-guarded)
 * produces byte-identical invoices.
 */
export const GET = withAuth(async (_req, { params }) => {
  try {
    const built = await buildInvoicePdfForOrder({ id: parseInt(params.id) });
    if (!built) return fail('Not found', 404);
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
});
