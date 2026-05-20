import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError } from '@/lib/api';
import { renderInvoicePdf, type InvoiceItem } from '@/lib/invoice';
import { detectStateFromAddress, GST_STATES } from '@/lib/gst-states';

/**
 * Fetch a setting value from the DB (with a static fallback so a
 * fresh install without seeded settings doesn't 500 the invoice).
 */
async function getSetting(key: string, fallback?: string): Promise<string | undefined> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? fallback;
}

export const GET = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { product: true } },
        customer: true,
      },
    });
    if (!order) return fail('Not found', 404);

    // ── Company / seller info ────────────────────────────────────────
    // Defaults below match the real business (Shoppers Hub, Pune)
    // so the invoice prints sensibly even before the admin fills in
    // the Settings UI. Overridden by whatever the admin has saved.
    const [
      companyName,
      companyGst,
      companyPan,
      companyAddress,
      companyStateName,
      companyStateCode,
    ] = await Promise.all([
      getSetting('company_name', 'Shoppers Hub'),
      getSetting('company_gst', '27AAQPR2976J1ZU'),
      getSetting('company_pan', 'AAQPR2976J'),
      getSetting(
        'company_address',
        'Near Dmart, Front Of Utsav Banquet Hall,\nKondhwa Budruk, Pune-411048\nPune, Maharashtra, 411048, IN',
      ),
      getSetting('company_state', 'Maharashtra'),
      getSetting('company_state_code', '27'),
    ]);

    // ── Buyer / place-of-supply detection ───────────────────────────
    // The shipping address is a single free-text string. Match against
    // Indian state names + aliases to figure out the state. Fall back
    // to the seller's state when nothing matches — that's the safer
    // default (charges CGST + SGST as if local) and is rare in
    // practice because most Indian addresses end with a state name.
    const detected = detectStateFromAddress(order.shippingAddress)
      ?? detectStateFromAddress(order.customer?.billingAddress)
      ?? GST_STATES.find((s) => s.name === companyStateName)
      ?? null;
    const placeOfSupply = detected ? { name: detected.name, code: detected.code } : null;
    const isInterState = !!(detected && detected.code !== companyStateCode);

    // ── Items + per-line breakdown ──────────────────────────────────
    // Each line's `lineTotal` in the DB already includes tax (the
    // checkout totalAmount uses it). The "taxable value" is the
    // pre-tax portion, derived as lineTotal / (1 + rate/100).
    const items: InvoiceItem[] = order.items.map((it) => {
      const taxPercent = Number(it.taxPercent);
      const lineTotal = Number(it.lineTotal);
      const taxableValue = +(lineTotal / (1 + taxPercent / 100)).toFixed(2);
      return {
        name: it.productName || '',
        sku: it.productSku || '',
        hsnCode: it.product?.hsnCode ?? null,
        quantity: it.quantity,
        unitPrice: Number(it.unitPrice),
        taxableValue,
        taxPercent,
        lineTotal,
      };
    });

    const subtotal = items.reduce((s, i) => s + i.taxableValue, 0);
    const totalTax = items.reduce((s, i) => s + (i.lineTotal - i.taxableValue), 0);
    const taxBreakdown = isInterState
      ? { cgst: 0, sgst: 0, igst: +totalTax.toFixed(2) }
      : {
          cgst: +(totalTax / 2).toFixed(2),
          sgst: +(totalTax / 2).toFixed(2),
          igst: 0,
        };

    const pdf = await renderInvoicePdf({
      orderNumber: order.orderNumber,
      date: order.createdAt,
      company: {
        name: companyName || 'Shoppers Hub',
        gst: companyGst,
        pan: companyPan,
        address: companyAddress,
        state: companyStateName,
        stateCode: companyStateCode,
      },
      customer: {
        name: order.customerName || order.customer?.name || 'Customer',
        email: order.customerEmail || order.customer?.email || undefined,
        phone: order.customerPhone || order.customer?.phone || undefined,
        address: order.shippingAddress || order.customer?.billingAddress || undefined,
        gstNumber: order.customer?.gstNumber || undefined,
      },
      placeOfSupply,
      isInterState,
      items,
      subtotal: +subtotal.toFixed(2),
      tax: +totalTax.toFixed(2),
      taxBreakdown,
      shipping: Number(order.shippingCost || 0),
      total: Number(order.totalAmount || 0),
    });

    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="invoice-${order.orderNumber}.pdf"`,
      },
    });
  } catch (e) {
    return handleError(e);
  }
});
