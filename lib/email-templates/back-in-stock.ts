/**
 * Back-in-stock alert — sent once, to a customer who asked to be told when a
 * sold-out product returned. Was inline in the notify-restock cron; moved here
 * so it shares the frame with the other customer emails.
 */
import {
  button, emailShell, esc, paragraph, spacer, textBody, textFooter,
  WHATSAPP_LINK, WHATSAPP_NUMBER,
} from './layout';

export interface BackInStockInput {
  productName: string;
  /** Storefront product URL. */
  url: string;
}

export function buildBackInStockEmail(o: BackInStockInput) {
  const subject = `Back in stock: ${o.productName}`;

  const body = [
    paragraph(
      `You asked us to tell you when <strong>${esc(o.productName)}</strong> was available again — it is, and you can order it now.`,
    ),
    spacer(10),
    button('View the product', o.url),
    spacer(20),
    paragraph(
      'We cannot hold stock against an alert, so if you still need it, it is worth ordering soon.',
      { muted: true, size: 13 },
    ),
    spacer(4),
    paragraph(
      `Need it urgently, or in bulk? <a href="${WHATSAPP_LINK}" style="color:#A01818;">WhatsApp ${WHATSAPP_NUMBER}</a> and we will sort it out directly.`,
      { size: 14 },
    ),
  ].join('');

  const html = emailShell({
    subject,
    preheader: `${o.productName} is available again — order it before it sells out.`,
    eyebrow: 'Back in stock',
    heading: 'It is available again.',
    body,
    footerNote:
      'You are getting this because you requested a stock alert on kitchenarykart.com. It is a one-time email for this product.',
  });

  const text = textBody([
    `Back in stock: ${o.productName}`,
    '',
    `You asked us to tell you when "${o.productName}" was available again — it is.`,
    '',
    o.url,
    '',
    'We cannot hold stock against an alert, so if you still need it, order soon.',
    '',
    `Need it urgently or in bulk? WhatsApp ${WHATSAPP_NUMBER}.`,
    '',
    'You are getting this because you requested a stock alert on kitchenarykart.com. It is a one-time email for this product.',
  ]) + textFooter();

  return { subject, html, text };
}
