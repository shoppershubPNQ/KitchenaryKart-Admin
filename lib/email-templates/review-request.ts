/**
 * Customer-facing email sent a few days after an order is delivered, asking
 * for a review of what they bought.
 *
 * Only real buyers can leave a review on the site (signed in + the order must
 * contain the SKU), so this is the one honest way to grow ratings — the
 * storefront no longer shows any invented rating.
 */
import {
  BRAND, button, emailShell, esc, paragraph, spacer, textBody, textFooter,
} from './layout';

export interface ReviewRequestInput {
  orderNumber: string;
  customerName: string | null;
  items: Array<{ name: string; sku: string }>;
  /** https://kitchenarykart.com */
  storeUrl: string;
}

export function buildReviewRequestEmail(o: ReviewRequestInput) {
  const first = (o.customerName || '').trim().split(/\s+/)[0] || null;
  const one = o.items[0];
  const subject =
    o.items.length === 1
      ? `How is your ${one.name.slice(0, 60)}? — Kitchenary Kart`
      : `How was your order ${o.orderNumber}? — Kitchenary Kart`;

  const productUrl = (sku: string) => `${o.storeUrl}/product/${encodeURIComponent(sku)}`;

  // One product: a single wide button. Several: a row per product, each with
  // its own link, so the buyer does not have to work out which is which.
  const picker =
    o.items.length === 1
      ? button('Write a review', productUrl(one.sku))
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${o.items
            .map(
              (it) => `
            <tr>
              <td style="padding:12px 0;border-bottom:1px solid ${BRAND.lineSoft};">
                <div style="color:${BRAND.ink};font-size:14px;font-weight:600;line-height:1.45;margin-bottom:8px;">${esc(it.name)}</div>
                <a href="${productUrl(it.sku)}" style="color:${BRAND.red};font-size:14px;font-weight:600;text-decoration:underline;">Write a review &rarr;</a>
              </td>
            </tr>`,
            )
            .join('')}
        </table>`;

  const body = [
    paragraph(
      `${first ? `Hi ${esc(first)}, your` : 'Your'} order <strong>${esc(o.orderNumber)}</strong> was delivered a few days ago. ` +
        `If you have a minute, a short review helps other restaurant and cafe owners decide.`,
    ),
    spacer(10),
    picker,
    spacer(22),
    paragraph(
      'Sign in with the same phone number or email you used for this order — only verified buyers can review, which is what keeps the ratings on our site honest.',
      { muted: true, size: 13 },
    ),
  ].join('');

  const html = emailShell({
    subject,
    preheader:
      o.items.length === 1
        ? `A minute on the ${one.name.slice(0, 60)} would help other buyers.`
        : 'A short review helps other restaurant and cafe owners decide.',
    eyebrow: 'Delivered',
    heading: 'How is it working out?',
    body,
    footerNote:
      "Something not right with the product? Reply to this email before leaving a review and we will sort it out first.",
  });

  const text = textBody([
    first ? `Hi ${first},` : 'Hi,',
    '',
    `Your order ${o.orderNumber} was delivered a few days ago. If you have a minute, a short review helps other restaurant and cafe owners decide.`,
    '',
    ...o.items.map((it) => `${it.name}: ${productUrl(it.sku)}`),
    '',
    'Sign in with the same phone number or email you used for the order — only verified buyers can review.',
    '',
    'Something not right? Reply to this email before leaving a review and we will sort it out first.',
  ]) + textFooter();

  return { subject, html, text };
}
