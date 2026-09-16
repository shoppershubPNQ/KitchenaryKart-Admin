/**
 * Customer-facing email sent a few days after an order is delivered, asking
 * for a review of what they bought.
 *
 * Only real buyers can leave a review on the site (signed in + the order must
 * contain the SKU), so this is the one honest way to grow ratings — the
 * storefront no longer shows any invented rating.
 */
export interface ReviewRequestInput {
  orderNumber: string;
  customerName: string | null;
  items: Array<{ name: string; sku: string }>;
  /** https://kitchenarykart.com */
  storeUrl: string;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export function buildReviewRequestEmail(o: ReviewRequestInput) {
  const first = (o.customerName || '').trim().split(/\s+/)[0] || 'there';
  const one = o.items[0];
  const subject =
    o.items.length === 1
      ? `How is your ${one.name.slice(0, 60)}? — KitchenaryKart`
      : `How was your order ${o.orderNumber}? — KitchenaryKart`;

  const rows = o.items
    .map(
      (it) => `
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#222;">${esc(it.name)}</td>
        <td style="padding:8px 0;text-align:right;">
          <a href="${o.storeUrl}/product/${encodeURIComponent(it.sku)}"
             style="display:inline-block;background:#A01818;color:#fff;text-decoration:none;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:bold;">Write a review</a>
        </td>
      </tr>`,
    )
    .join('');

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#222;">
    <h2 style="color:#A01818;margin:0 0 6px;">How is it working out?</h2>
    <p style="margin:0 0 16px;color:#555;">Hi ${esc(first)}, your order <strong>${esc(o.orderNumber)}</strong> was delivered a few days ago.
      If you have a minute, a short review helps other restaurant and cafe owners decide.</p>

    <table style="width:100%;border-collapse:collapse;border-top:1px solid #eee;">${rows}</table>

    <p style="color:#888;font-size:13px;margin-top:18px;">
      Sign in with the same phone number or email you used for this order — only verified buyers can review,
      which is what keeps the ratings on our site honest.
    </p>
    <p style="color:#888;font-size:13px;">Something not right with the product? Reply to this email or WhatsApp
      +91 98903 52455 and we'll sort it out first.</p>
  </div>`;

  const text = [
    `Hi ${first}, your order ${o.orderNumber} was delivered a few days ago.`,
    'If you have a minute, a short review helps other restaurant and cafe owners decide.',
    '',
    ...o.items.map((it) => `${it.name}: ${o.storeUrl}/product/${encodeURIComponent(it.sku)}`),
    '',
    'Sign in with the same phone number or email you used for the order — only verified buyers can review.',
    "Something not right? Reply to this email or WhatsApp +91 98903 52455 and we'll sort it out first.",
  ].join('\n');

  return { subject, html, text };
}
