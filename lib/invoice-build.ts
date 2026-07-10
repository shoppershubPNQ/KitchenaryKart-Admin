/**
 * Build an order's invoice PDF from the database.
 *
 * Extracted from app/api/orders/[id]/invoice/route.ts so the same
 * data-assembly + rendering can be reused by:
 *   - the admin-only route (GET /api/orders/[id]/invoice, admin JWT), and
 *   - the internal route (GET /api/public/invoice, shared-secret), which the
 *     storefront calls to let a logged-in customer download their own invoice.
 *
 * Keeping this in one place means the tax logic, place-of-supply detection,
 * proforma-vs-serial rule and company defaults never drift between the two.
 */
import { prisma } from '@/lib/db';
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

export interface BuiltInvoice {
  pdf: Uint8Array;
  orderNumber: string;
  /** The order's owning customer id (null for guest/legacy orders), so callers
   *  can do a defence-in-depth ownership check. */
  customerId: number | null;
}

/**
 * Assemble and render an order's invoice PDF. Look the order up by numeric
 * `id` (admin route) or by `orderNumber` (storefront proxy). Returns null when
 * no such order exists.
 */
export async function buildInvoicePdfForOrder(
  where: { id?: number; orderNumber?: string },
): Promise<BuiltInvoice | null> {
  const order = await prisma.order.findUnique({
    where: where.id != null ? { id: where.id } : { orderNumber: where.orderNumber! },
    include: {
      items: { include: { product: true } },
      customer: true,
    },
  });
  if (!order) return null;

  // ── Company / seller info ────────────────────────────────────────
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

  // GST invoice number — KK/<FY>/<NNNN>. Allocated only for PAID orders
  // (normally at payment-success time). An unpaid order gets no serial →
  // we render a PROFORMA referencing the order number, so viewing an
  // unpaid order's invoice never burns a real tax-invoice number.
  const { formatted } = await ensureInvoiceNumber(order.id);
  const proforma = formatted == null;
  const invoiceNumber = formatted ?? `PRO/${order.orderNumber}`;

  const pdf = await renderInvoicePdf({
    orderNumber: order.orderNumber,
    invoiceNumber,
    proforma,
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
      billingAddress: order.customer?.billingAddress || order.shippingAddress || undefined,
      shippingAddress: order.shippingAddress || order.customer?.billingAddress || undefined,
      gstNumber: order.customerGstin || order.customer?.gstNumber || undefined,
    },
    placeOfSupply,
    isInterState,
    taxBreakdown,
    summary,
  });

  return {
    pdf: new Uint8Array(pdf),
    orderNumber: order.orderNumber,
    customerId: order.customerId ?? null,
  };
}
