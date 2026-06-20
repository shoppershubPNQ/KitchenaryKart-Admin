/**
 * Internal email sent to the business when a NEW paid order comes in.
 * Distinct from the customer-facing order-confirmation: this one alerts
 * the team so they can start fulfilment without watching the dashboard.
 */
export interface AdminNewOrderInput {
  orderNumber: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  totalAmount: number;
  discountAmount?: number | null;
  couponCode?: string | null;
  paymentReference?: string | null;
  items: Array<{ name: string; sku: string; quantity: number; lineTotal: number }>;
  /** Deep link to the order in the admin dashboard. */
  adminOrderUrl: string;
}

const inr = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildAdminNewOrderEmail(o: AdminNewOrderInput) {
  const qty = o.items.reduce((s, i) => s + i.quantity, 0);
  const subject = `🛒 New order ${o.orderNumber} — ${inr(o.totalAmount)} (${qty} item${qty === 1 ? '' : 's'})`;

  const rows = o.items
    .map(
      (i) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;">${i.name}<br><span style="color:#888;font-size:12px;">SKU: ${i.sku}</span></td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;">${i.quantity}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${inr(i.lineTotal)}</td>
      </tr>`,
    )
    .join('');

  const discountLine =
    o.discountAmount && o.discountAmount > 0
      ? `<p style="margin:4px 0;color:#0A7D33;">Discount${o.couponCode ? ` (${o.couponCode})` : ''}: − ${inr(o.discountAmount)}</p>`
      : '';

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#222;">
    <h2 style="color:#A01818;margin:0 0 4px;">New paid order received 🎉</h2>
    <p style="margin:0 0 16px;color:#555;">Order <strong>${o.orderNumber}</strong> has been paid. Start fulfilment.</p>

    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:14px;">
      <thead>
        <tr style="background:#1F1F1F;color:#fff;">
          <th style="padding:6px 10px;text-align:left;">Item</th>
          <th style="padding:6px 10px;text-align:center;">Qty</th>
          <th style="padding:6px 10px;text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    ${discountLine}
    <p style="margin:4px 0;font-size:16px;"><strong>Total paid: ${inr(o.totalAmount)}</strong></p>

    <div style="margin:16px 0;padding:12px;background:#FAF7EE;border-radius:8px;font-size:14px;">
      <strong>Customer</strong><br>
      ${o.customerName || '—'}<br>
      ${o.customerPhone ? `📞 ${o.customerPhone}<br>` : ''}
      ${o.customerEmail ? `✉️ ${o.customerEmail}<br>` : ''}
      ${o.paymentReference ? `<span style="color:#888;font-size:12px;">Razorpay: ${o.paymentReference}</span>` : ''}
    </div>

    <a href="${o.adminOrderUrl}" style="display:inline-block;background:#A01818;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:bold;">View order in dashboard →</a>
  </div>`;

  const text = [
    `New paid order ${o.orderNumber} — ${inr(o.totalAmount)}`,
    '',
    ...o.items.map((i) => `- ${i.name} (SKU ${i.sku}) x${i.quantity} = ${inr(i.lineTotal)}`),
    o.discountAmount && o.discountAmount > 0
      ? `Discount${o.couponCode ? ` (${o.couponCode})` : ''}: -${inr(o.discountAmount)}`
      : '',
    `Total paid: ${inr(o.totalAmount)}`,
    '',
    `Customer: ${o.customerName || '—'}`,
    o.customerPhone ? `Phone: ${o.customerPhone}` : '',
    o.customerEmail ? `Email: ${o.customerEmail}` : '',
    '',
    `View: ${o.adminOrderUrl}`,
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text };
}
