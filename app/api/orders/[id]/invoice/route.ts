import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError } from '@/lib/api';
import { renderInvoicePdf } from '@/lib/invoice';
import { detectStateFromAddress, GST_STATES } from '@/lib/gst-states';
import { ensureInvoiceNumber } from '@/lib/invoice-serial';
import { computeOrderSummary } from '@/lib/order-summary';

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

    // ── Items + per-line breakdown (shared helper = identical to the
    // website/admin/print). GST is computed on the DISCOUNTED net value;
    // each line's stored lineTotal is GST-inclusive. ────────────────────
    const summary = computeOrderSummary(
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
    const taxBreakdown = isInterState
      ? { cgst: 0, sgst: 0, igst: summary.gstAmount }
      : {
          cgst: +(summary.gstAmount / 2).toFixed(2),
          sgst: +(summary.gstAmount / 2).toFixed(2),
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
      taxBreakdown,
      summary,
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
