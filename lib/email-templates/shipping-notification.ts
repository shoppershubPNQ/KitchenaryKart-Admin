/**
 * Customer-facing email sent when an order ships (tracking added / status
 * moved to "shipped"). Gives the carrier + tracking number + a track link
 * so the buyer can follow the shipment.
 */
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
  const subject = `📦 Your order ${o.orderNumber} has shipped — KitchenaryKart`;

  const trackButton = o.trackingUrl
    ? `<a href="${o.trackingUrl}" style="display:inline-block;background:#A01818;color:#fff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:bold;">Track with ${o.carrierName || 'carrier'} →</a>`
    : `<a href="${o.trackUrl}" style="display:inline-block;background:#A01818;color:#fff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:bold;">Track your order →</a>`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#222;">
    <h2 style="color:#A01818;margin:0 0 6px;">Your order is on the way! 🚚</h2>
    <p style="margin:0 0 16px;color:#555;">Hi ${o.customerName || 'there'}, your order <strong>${o.orderNumber}</strong> has been shipped.</p>

    <div style="margin:14px 0;padding:14px;background:#FAF7EE;border-radius:8px;font-size:14px;line-height:1.7;">
      ${o.carrierName ? `<div><strong>Carrier:</strong> ${o.carrierName}</div>` : ''}
      ${o.trackingNumber ? `<div><strong>Tracking / AWB:</strong> <span style="font-family:monospace;">${o.trackingNumber}</span></div>` : ''}
    </div>

    <p style="margin:18px 0;">${trackButton}</p>

    <p style="color:#888;font-size:13px;margin-top:20px;">You can also view live status anytime at
      <a href="${o.trackUrl}" style="color:#A01818;">${o.trackUrl}</a>.</p>
    <p style="color:#888;font-size:13px;">Questions? WhatsApp us at +91 98903 52455.</p>
  </div>`;

  const text = [
    `Your order ${o.orderNumber} has shipped!`,
    '',
    o.carrierName ? `Carrier: ${o.carrierName}` : '',
    o.trackingNumber ? `Tracking / AWB: ${o.trackingNumber}` : '',
    o.trackingUrl ? `Track: ${o.trackingUrl}` : '',
    '',
    `View status: ${o.trackUrl}`,
    'Questions? WhatsApp +91 98903 52455.',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text };
}
