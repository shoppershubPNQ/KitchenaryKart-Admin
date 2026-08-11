/**
 * Credit notes — list + issue.
 *
 * GET  ?orderId=  notes against one order, plus a preview of what a full note
 *                 would contain and how much is still creditable.
 *      (no param) every note, newest first, for the Credit Notes page.
 * POST issue one. `issuedAt` decides which month's GSTR-1 it lands in.
 */
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok, fail } from '@/lib/api';
import {
  CREDIT_NOTE_REASONS,
  formatCreditNoteNumber,
  issueCreditNote,
  previewCreditNote,
} from '@/lib/credit-note';
import { z } from 'zod';

const createSchema = z.object({
  orderId: z.number().int().positive(),
  reason: z.string().trim().min(2),
  notes: z.string().trim().optional().nullable(),
  /** Omit for a full credit note. */
  amount: z.number().positive().optional().nullable(),
  /** ISO date. Omit for today. Decides the return month. */
  issuedAt: z.string().optional(),
});

export const GET = withAuth(async (req) => {
  try {
    const orderId = new URL(req.url).searchParams.get('orderId');

    if (orderId) {
      const id = parseInt(orderId);
      if (!Number.isFinite(id)) return fail('Bad orderId', 400);
      const notes = await prisma.creditNote.findMany({
        where: { orderId: id },
        orderBy: { serial: 'desc' },
      });
      let preview = null;
      try {
        const p = await previewCreditNote(id);
        preview = {
          invoiceNumber: p.invoiceNumber,
          taxableValue: p.taxableValue,
          cgst: p.cgst, sgst: p.sgst, igst: p.igst,
          totalAmount: p.totalAmount,
          alreadyCredited: p.alreadyCredited,
          creditableRemaining: p.creditableRemaining,
          placeOfSupply: p.placeOfSupply,
        };
      } catch (e) {
        // No invoice yet — the page shows why rather than an empty panel.
        preview = { error: e instanceof Error ? e.message : 'Cannot credit this order' };
      }
      return ok({
        creditNotes: notes.map((n) => ({ ...n, number: formatCreditNoteNumber(n.financialYear, n.serial) })),
        preview,
        reasons: CREDIT_NOTE_REASONS,
      });
    }

    const notes = await prisma.creditNote.findMany({
      orderBy: [{ issuedAt: 'desc' }, { serial: 'desc' }],
      take: 200,
      include: { order: { select: { orderNumber: true, customerName: true } } },
    });
    return ok({
      creditNotes: notes.map((n) => ({ ...n, number: formatCreditNoteNumber(n.financialYear, n.serial) })),
      reasons: CREDIT_NOTE_REASONS,
    });
  } catch (e) {
    return handleError(e);
  }
});

export const POST = withAuth(async (req) => {
  try {
    const body = createSchema.parse(await req.json());
    const issuedAt = body.issuedAt ? new Date(body.issuedAt) : undefined;
    if (issuedAt && Number.isNaN(issuedAt.getTime())) return fail('Bad issuedAt date', 400);

    const note = await issueCreditNote({
      orderId: body.orderId,
      reason: body.reason,
      notes: body.notes ?? null,
      amount: body.amount ?? null,
      issuedAt,
    });
    return ok(
      { creditNote: { ...note, number: formatCreditNoteNumber(note.financialYear, note.serial) } },
      { status: 201 },
    );
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'accounts']);
