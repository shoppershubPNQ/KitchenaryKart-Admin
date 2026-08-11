/**
 * Credit note PDF — what the accountant files and the customer keeps.
 */
import { withAuth } from '@/lib/auth';
import { fail, handleError } from '@/lib/api';
import { renderCreditNotePdf } from '@/lib/credit-note-pdf';

export const GET = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    if (!Number.isFinite(id)) return fail('Bad id', 400);

    const built = await renderCreditNotePdf(id);
    if (!built) return fail('Credit note not found', 404);

    // Cast to BodyInit: a Uint8Array is a valid Response body at runtime, but
    // TS 5.7+ won't accept Uint8Array<ArrayBufferLike>. Same quirk as the
    // invoice route.
    return new Response(built.pdf as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${built.number.replace(/\//g, '-')}.pdf"`,
      },
    });
  } catch (e) {
    return handleError(e);
  }
});
