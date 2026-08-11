/**
 * GST credit notes.
 *
 * A credit note reverses part or all of an ALREADY-INVOICED sale. It is not an
 * edit of the original invoice: once an invoice sits in a filed GSTR-1 it stays
 * there, and the reversal is declared in the month the return actually happened.
 * That is why the note carries its own date and its own serial series.
 *
 * Serial format `CN/<FY>/<NNNN>`, separate from the invoice series — GSTR-1
 * reports credit notes in their own table (CDNR for B2B, CDNUR for B2C), and a
 * shared series would collide with invoice numbers.
 */
import { prisma } from './db';
import { getFinancialYear } from './invoice-serial';
import { computeOrderSummary } from './order-summary';
import { detectStateFromAddress, GST_STATES } from './gst-states';

const SELLER_STATE_CODE = '27';

export const CREDIT_NOTE_REASONS = [
  'Sales return',
  'Post-sale discount',
  'Deficiency in service',
  'Correction in invoice',
  'Change in POS',
  'Others',
] as const;
export type CreditNoteReason = (typeof CREDIT_NOTE_REASONS)[number];

export function formatCreditNoteNumber(fy: string, serial: number): string {
  return `CN/${fy}/${String(serial).padStart(4, '0')}`;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * What a full credit note against this order would contain.
 *
 * Derived from the SAME helper the invoice used, so the note reverses exactly
 * what was charged — recomputing it a second way is how the two drift apart.
 */
export async function previewCreditNote(orderId: number) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } }, customer: true, creditNotes: true },
  });
  if (!order) throw new Error('Order not found');
  if (!order.invoiceSerial || !order.invoiceFinancialYear) {
    throw new Error('This order has no invoice — there is nothing to credit');
  }

  const breakdown = computeOrderSummary(
    order.items.map((it) => ({
      name: it.productName || '',
      sku: it.productSku || '',
      hsnCode: it.product?.hsnCode ?? null,
      lineInclusive: Number(it.lineTotal),
      quantity: it.quantity,
      taxPercent: Number(it.taxPercent),
    })),
    Number(order.discountAmount || 0),
    Number(order.shippingCost || 0),
  );

  const detected =
    detectStateFromAddress(order.shippingAddress) ??
    detectStateFromAddress(order.customer?.billingAddress) ??
    GST_STATES.find((s) => s.code === SELLER_STATE_CODE) ??
    null;
  const isInterState = !!detected && detected.code !== SELLER_STATE_CODE;

  // Freight is part of the taxable value of the supply, so a full credit note
  // reverses it too — the customer is getting the delivery charge back as well.
  const taxableValue = round2(breakdown.netValue + breakdown.shipping);
  const gst = breakdown.gstAmount;

  // Already credited, so a second note cannot quietly double the reversal.
  const alreadyCredited = round2(
    order.creditNotes.reduce((s, c) => s + Number(c.totalAmount), 0),
  );

  return {
    order,
    invoiceNumber: `KK/${order.invoiceFinancialYear}/${String(order.invoiceSerial).padStart(4, '0')}`,
    invoiceDate: order.createdAt,
    taxableValue,
    cgst: isInterState ? 0 : round2(gst / 2),
    sgst: isInterState ? 0 : round2(gst / 2),
    igst: isInterState ? gst : 0,
    totalAmount: round2(Number(order.totalAmount)),
    placeOfSupply: detected?.name ?? '',
    placeOfSupplyCode: detected?.code ?? '',
    isInterState,
    alreadyCredited,
    creditableRemaining: round2(Number(order.totalAmount) - alreadyCredited),
  };
}

/**
 * Issue a credit note. `issuedAt` decides which month's return it lands in, so
 * it is a parameter rather than always "now" — a return processed late still
 * belongs to the month it happened.
 *
 * The serial is taken inside a transaction with a re-read, so two admins
 * clicking at once cannot be handed the same number.
 */
export async function issueCreditNote(args: {
  orderId: number;
  reason: CreditNoteReason | string;
  notes?: string | null;
  /** Full credit when omitted. */
  amount?: number | null;
  issuedAt?: Date;
}) {
  const p = await previewCreditNote(args.orderId);
  const issuedAt = args.issuedAt ?? new Date();
  const fy = getFinancialYear(issuedAt);

  const full = p.creditableRemaining;
  if (full <= 0) throw new Error('This invoice is already fully credited');

  const amount = args.amount == null ? full : round2(args.amount);
  if (amount <= 0) throw new Error('Credit amount must be greater than zero');
  if (amount > full + 0.01) {
    throw new Error(`Cannot credit ${amount} — only ${full} remains uncredited on this invoice`);
  }

  // A partial note reverses the same PROPORTION of taxable value and tax, so
  // the note's own arithmetic still satisfies tax = taxable x rate.
  const ratio = p.totalAmount > 0 ? amount / p.totalAmount : 0;

  return prisma.$transaction(async (tx) => {
    const last = await tx.creditNote.findFirst({
      where: { financialYear: fy },
      orderBy: { serial: 'desc' },
      select: { serial: true },
    });
    const serial = (last?.serial ?? 0) + 1;

    return tx.creditNote.create({
      data: {
        serial,
        financialYear: fy,
        orderId: args.orderId,
        invoiceNumber: p.invoiceNumber,
        invoiceDate: p.invoiceDate,
        reason: args.reason,
        notes: args.notes ?? null,
        taxableValue: round2(p.taxableValue * ratio),
        cgst: round2(p.cgst * ratio),
        sgst: round2(p.sgst * ratio),
        igst: round2(p.igst * ratio),
        totalAmount: amount,
        customerName: p.order.customerName,
        customerGstin: p.order.customerGstin || p.order.customer?.gstNumber || null,
        placeOfSupply: p.placeOfSupply,
        placeOfSupplyCode: p.placeOfSupplyCode,
        issuedAt,
      },
    });
  });
}
