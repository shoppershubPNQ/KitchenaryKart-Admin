/**
 * Order-confirmation email — fires once Razorpay verifies the payment.
 *
 * Frame, spacing and mobile behaviour come from ./layout, shared with every
 * other customer email so the four of them look like one sender.
 */
import {
  BRAND, button, emailShell, esc, factRows, inr, itemsTable, label, panel,
  paragraph, spacer, STORE_URL, textBody, textFooter, totalsTable,
} from './layout';

export interface OrderEmailInput {
  orderNumber: string;
  customerName: string | null;
  totalAmount: number;
  subtotal: number;
  taxAmount: number;
  shippingCost: number;
  shippingAddress: string | null;
  items: Array<{
    name: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  paymentReference: string | null;
}

export function buildOrderConfirmationEmail(o: OrderEmailInput) {
  const firstName = o.customerName ? o.customerName.split(' ')[0] : null;
  const subject = `Order ${o.orderNumber} confirmed — Kitchenary Kart`;
  const trackUrl = `${STORE_URL}/track?order=${encodeURIComponent(o.orderNumber)}`;

  // GST-compliant ladder that ADDS UP: prices are GST-inclusive, so the goods
  // subtotal is shown ex-GST (derived from the total so it reflects any coupon
  // discount) and GST is broken out on its own line. netExGst + GST + Shipping
  // = Total by construction, and the GST matches the tax invoice PDF.
  const netExGst = (o.totalAmount || 0) - (o.taxAmount || 0) - (o.shippingCost || 0);
  const itemCount = o.items.reduce((n, it) => n + it.quantity, 0);

  const body = [
    paragraph(
      `${firstName ? `Hi ${esc(firstName)}, your` : 'Your'} payment came through and the order is with our team. ` +
        `We will email you again the moment it ships, with the tracking number.`,
    ),
    spacer(6),
    panel(
      factRows([
        { k: 'Order number', v: o.orderNumber, mono: true },
        { k: 'Total paid', v: inr(o.totalAmount) },
      ]),
    ),
    spacer(24),
    label(`${itemCount} item${itemCount === 1 ? '' : 's'}`),
    itemsTable(
      o.items.map((it) => ({
        name: it.name,
        meta: `SKU ${it.sku} · Qty ${it.quantity} × ${inr(it.unitPrice)}`,
        amount: inr(it.lineTotal),
      })),
    ),
    spacer(16),
    totalsTable([
      { k: 'Subtotal (excl. GST)', v: inr(netExGst) },
      { k: 'GST', v: inr(o.taxAmount) },
      { k: 'Shipping', v: o.shippingCost > 0 ? inr(o.shippingCost) : 'Free' },
      { k: 'Total paid', v: inr(o.totalAmount), strong: true },
    ]),
    o.shippingAddress
      ? spacer(26) +
        label('Shipping to') +
        `<div style="color:${BRAND.body};font-size:14px;line-height:1.6;white-space:pre-line;">${esc(o.shippingAddress)}</div>`
      : '',
    spacer(28),
    button('Track this order', trackUrl),
    spacer(20),
  ].join('');

  const html = emailShell({
    subject,
    preheader: `Paid ${inr(o.totalAmount)} · ${itemCount} item${itemCount === 1 ? '' : 's'} · we will send tracking as soon as it ships.`,
    eyebrow: 'Order confirmed',
    heading: 'Thank you — your order is in.',
    body,
    footerNote: o.paymentReference
      ? `Payment reference: ${esc(o.paymentReference)}. Your GST tax invoice is available on the order page.`
      : 'Your GST tax invoice is available on the order page.',
  });

  const text = textBody([
    firstName ? `Hi ${firstName},` : 'Hi,',
    '',
    'Your payment came through and the order is with our team. We will email you again the moment it ships.',
    '',
    `Order number: ${o.orderNumber}`,
    '',
    'Items:',
    ...o.items.map((it) => `  - ${it.name} (SKU ${it.sku}) x ${it.quantity} — ${inr(it.lineTotal)}`),
    '',
    `Subtotal (excl. GST): ${inr(netExGst)}`,
    `GST: ${inr(o.taxAmount)}`,
    `Shipping: ${o.shippingCost > 0 ? inr(o.shippingCost) : 'Free'}`,
    `Total paid: ${inr(o.totalAmount)}`,
    '',
    o.shippingAddress ? `Shipping to:\n${o.shippingAddress}` : '',
    '',
    `Track your order: ${trackUrl}`,
    o.paymentReference ? `Payment reference: ${o.paymentReference}` : '',
  ]) + textFooter();

  return { subject, html, text };
}
