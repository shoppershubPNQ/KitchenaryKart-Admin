/**
 * Customer-facing email sent when an order ships (tracking added / status
 * moved to "shipped"). Gives the carrier + tracking number + a track link
 * so the buyer can follow the shipment.
 */
import {
  button, emailShell, esc, factRows, panel, paragraph, spacer, textBody, textFooter,
} from './layout';

export interface ShippingEmailInput {
  orderNumber: string;
  customerName: string | null;
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  /** Storefront link where the customer can see live status. */
  trackUrl: string;
}

export function buildShippingNotificationEmail(o: ShippingEmailInput) {
  const firstName = o.customerName ? o.customerName.split(' ')[0] : null;
  const subject = `Your order ${o.orderNumber} has shipped — Kitchenary Kart`;

  const facts: Array<{ k: string; v: string; mono?: boolean }> = [
    { k: 'Order number', v: o.orderNumber, mono: true },
  ];
  if (o.carrierName) facts.push({ k: 'Carrier', v: o.carrierName });
  if (o.trackingNumber) facts.push({ k: 'Tracking / AWB', v: o.trackingNumber, mono: true });

  const body = [
    paragraph(
      `${firstName ? `Hi ${esc(firstName)}, your` : 'Your'} order has left our warehouse and is on its way to you.`,
    ),
    spacer(6),
    panel(factRows(facts)),
    spacer(26),
    button(o.trackingUrl ? `Track with ${o.carrierName || 'the carrier'}` : 'Track your order', o.trackingUrl || o.trackUrl),
    spacer(18),
    paragraph(
      `You can also check live status any time on <a href="${esc(o.trackUrl)}" style="color:#A01818;">your order page</a>.`,
      { muted: true, size: 13 },
    ),
  ].join('');

  const html = emailShell({
    subject,
    preheader: o.trackingNumber
      ? `${o.carrierName ? o.carrierName + ' · ' : ''}Tracking ${o.trackingNumber}`
      : 'Your order is on its way — track it here.',
    eyebrow: 'On the way',
    heading: 'Your order has shipped.',
    body,
    footerNote: 'Tracking can take a few hours to show its first scan after pickup.',
  });

  const text = textBody([
    firstName ? `Hi ${firstName},` : 'Hi,',
    '',
    `Your order ${o.orderNumber} has shipped and is on its way.`,
    '',
    o.carrierName ? `Carrier: ${o.carrierName}` : '',
    o.trackingNumber ? `Tracking / AWB: ${o.trackingNumber}` : '',
    o.trackingUrl ? `Track with the carrier: ${o.trackingUrl}` : '',
    '',
    `Live status: ${o.trackUrl}`,
    '',
    'Tracking can take a few hours to show its first scan after pickup.',
  ]) + textFooter();

  return { subject, html, text };
}
