/**
 * Order-confirmation email — fires once Razorpay verifies the payment.
 *
 * Visual style mirrors the OTP email (web/lib/email.ts buildOtpEmail) so
 * customers recognize the sender: cream background, dark accent strip,
 * Georgia serif for the wordmark.
 */

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

function inr(n: number): string {
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildOrderConfirmationEmail(o: OrderEmailInput) {
  const firstName = o.customerName ? o.customerName.split(' ')[0] : null;
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';

  const subject = `Order ${o.orderNumber} confirmed — KitchenaryKart`;

  const itemRows = o.items
    .map(
      (it) => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #f0ebde;vertical-align:top;">
            <div style="color:#1a1a1a;font-size:14px;font-weight:500;line-height:1.4;">${escapeHtml(
              it.name,
            )}</div>
            <div style="color:#999;font-size:12px;margin-top:2px;">SKU ${escapeHtml(it.sku)} · Qty ${it.quantity}</div>
          </td>
          <td style="padding:12px 0;border-bottom:1px solid #f0ebde;text-align:right;vertical-align:top;color:#1a1a1a;font-size:14px;font-weight:500;">${inr(
            it.lineTotal,
          )}</td>
        </tr>`,
    )
    .join('');

  const shippingBlock = o.shippingAddress
    ? `
    <tr>
      <td style="padding:24px 32px 8px 32px;color:#777;font-size:12px;letter-spacing:0.5px;text-transform:uppercase;">Shipping to</td>
    </tr>
    <tr>
      <td style="padding:0 32px 24px 32px;color:#1a1a1a;font-size:14px;line-height:1.55;white-space:pre-line;">${escapeHtml(
        o.shippingAddress,
      )}</td>
    </tr>`
    : '';

  // GST-compliant ladder that ADDS UP: prices are GST-inclusive, so the goods
  // subtotal is shown ex-GST (derived from the total so it reflects any coupon
  // discount) and GST is broken out on its own line. netExGst + GST + Shipping
  // = Total by construction, and the GST matches the tax invoice PDF.
  const netExGst = (o.totalAmount || 0) - (o.taxAmount || 0) - (o.shippingCost || 0);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f5f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f1ea;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:8px;border:1px solid #e8e2d4;max-width:560px;width:100%;">

          <tr>
            <td style="padding:32px 32px 8px 32px;text-align:center;">
              <div style="font-family:Georgia,serif;font-size:24px;font-weight:700;color:#1a1a1a;letter-spacing:0.5px;">KitchenaryKart</div>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 32px 8px 32px;text-align:center;">
              <div style="display:inline-block;background:#1a1a1a;color:#efe3d0;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:6px 14px;border-radius:4px;">Order Confirmed</div>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 32px 8px 32px;color:#1a1a1a;font-size:15px;line-height:1.55;">
              <p style="margin:0 0 8px 0;">${greeting}</p>
              <p style="margin:0;">Thanks for shopping with KitchenaryKart — your order has been received and your payment was successful. We'll send another note once it ships.</p>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 32px 8px 32px;color:#777;font-size:12px;letter-spacing:0.5px;text-transform:uppercase;">Order number</td>
          </tr>
          <tr>
            <td style="padding:0 32px 8px 32px;color:#1a1a1a;font-size:16px;font-weight:600;font-family:'Courier New',monospace;">${escapeHtml(
              o.orderNumber,
            )}</td>
          </tr>

          <tr>
            <td style="padding:20px 32px 0 32px;color:#777;font-size:12px;letter-spacing:0.5px;text-transform:uppercase;">Items</td>
          </tr>
          <tr>
            <td style="padding:8px 32px 0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${itemRows}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:12px 32px 4px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="color:#555;font-size:13px;line-height:1.6;">
                <tr><td style="text-align:left;">Subtotal (excl. GST)</td><td style="text-align:right;">${inr(netExGst)}</td></tr>
                <tr><td style="text-align:left;">GST</td><td style="text-align:right;">${inr(o.taxAmount)}</td></tr>
                <tr><td style="text-align:left;">Shipping</td><td style="text-align:right;">${inr(o.shippingCost)}</td></tr>
                <tr>
                  <td style="text-align:left;padding-top:8px;border-top:1px solid #f0ebde;color:#1a1a1a;font-size:15px;font-weight:700;">Total paid</td>
                  <td style="text-align:right;padding-top:8px;border-top:1px solid #f0ebde;color:#1a1a1a;font-size:15px;font-weight:700;">${inr(o.totalAmount)}</td>
                </tr>
              </table>
            </td>
          </tr>

          ${shippingBlock}

          <tr>
            <td style="padding:20px 32px 8px 32px;text-align:center;">
              <a href="https://kitchenarykart.com/track?order=${encodeURIComponent(o.orderNumber)}" style="display:inline-block;background:#A01818;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:6px;letter-spacing:0.3px;">Track this order →</a>
            </td>
          </tr>

          ${o.paymentReference
            ? `<tr>
                 <td style="padding:8px 32px 16px 32px;color:#999;font-size:12px;text-align:center;">Payment reference: ${escapeHtml(o.paymentReference)}</td>
               </tr>`
            : ''}

          <tr>
            <td style="padding:16px 32px 28px 32px;border-top:1px solid #f0ebde;color:#999;font-size:12px;text-align:center;">
              <div>Questions about your order? Reply to this email or write to <a href="mailto:support@kitchenarykart.com" style="color:#1a1a1a;text-decoration:underline;">support@kitchenarykart.com</a>.</div>
              <div style="margin-top:8px;">KitchenaryKart · Commercial kitchen equipment</div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `${firstName ? `Hi ${firstName},` : 'Hi,'}

Thanks for shopping with KitchenaryKart — your order has been received and your payment was successful.

Order number: ${o.orderNumber}

Items:
${o.items.map((it) => `  - ${it.name} (SKU ${it.sku}) × ${it.quantity} — ${inr(it.lineTotal)}`).join('\n')}

Subtotal (excl. GST): ${inr(netExGst)}
GST: ${inr(o.taxAmount)}
Shipping: ${inr(o.shippingCost)}
Total paid: ${inr(o.totalAmount)}

${o.shippingAddress ? `Shipping to:\n${o.shippingAddress}\n\n` : ''}Track your order: https://kitchenarykart.com/track?order=${encodeURIComponent(o.orderNumber)}

${o.paymentReference ? `Payment reference: ${o.paymentReference}\n\n` : ''}Questions? Reply or write to support@kitchenarykart.com.

— KitchenaryKart`;

  return { subject, html, text };
}
