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
    return new Response(built.pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="invoice-${built.orderNumber}.pdf"`,
      },
    });
  } catch (e) {
    return handleError(e);
  }
});
