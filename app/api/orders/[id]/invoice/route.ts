import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError } from '@/lib/api';
import { renderInvoicePdf, type InvoiceItem } from '@/lib/invoice';
import { detectStateFromAddress, GST_STATES } from '@/lib/gst-states';
import { ensureInvoiceNumber } from '@/lib/invoice-serial';

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
    // Defaults match the Kitchenary Kart trade name used on the D2C
    // storefront. Same legal entity / GSTIN / PAN as "Shoppers Hub"
    // (the marketplace seller name) — just a different display name
    // and registered address per the GST additional-place-of-business
    // entry. Admin can override each value in the Settings UI.
    const [
      companyName,
      companyGst,
      companyPan,
      companyAddress,
      companyStateName,
      companyStateCode,
    ] = await Promise.all([
      getSetting('company_name', 'Kitchenary Kart'),
      getSetting('company_gst', '27AAQPR2976J1ZU'),
      getSetting('company_pan', 'AAQPR2976J'),
      getSetting(
        'company_address',
        'A2/103, Parshwanagar, Opp. Swami Vivekanand Garden,\nKondhwa Budruk, Pune-411048\nMaharashtra, India',
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

    // Allocate (or fetch existing) GST invoice number — KK/<FY>/<NNNN>.
    // Lazy so pending/cancelled orders never burn a serial.
    const { formatted: invoiceNumber } = await ensureInvoiceNumber(order.id);

    const pdf = await renderInvoicePdf({
      orderNumber: order.orderNumber,
      invoiceNumber,
      date: order.createdAt,
      company: {
        name: companyName || 'Kitchenary Kart',
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
        // Billing and shipping are tracked separately so B2B / gift-order
        // flows where they differ render correctly. Today the Order
        // model only stores shippingAddress, so billing falls back to
        // the customer's stored billingAddress and then to the
        // shippingAddress — both blocks end up showing the same string
        // for typical D2C orders, which is fine.
        billingAddress: order.customer?.billingAddress || order.shippingAddress || undefined,
        shippingAddress: order.shippingAddress || order.customer?.billingAddress || undefined,
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
      discount: Number(order.discountAmount || 0),
      couponCode: order.couponCode || undefined,
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
