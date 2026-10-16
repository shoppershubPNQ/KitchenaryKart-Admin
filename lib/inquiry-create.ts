/**
 * Create an Inquiry and tell the team - shared by the public quote form
 * (app/api/public/inquiries) and the website chatbot's save_lead tool
 * (lib/chatbot/tools.ts).
 *
 * Moved out of the public inquiries route WITHOUT changing its behaviour: the
 * row written, the email (Resend, same inboxes, awaited, never throws) and the
 * response are byte-identical. The only addition is `opts.subject`, which lets
 * the chatbot label its emails "New chatbot lead"; the default subject is the
 * form's original one.
 */
import { prisma } from './db';
import { sendEmail } from './integrations/resend';
import { adminBaseUrl, adminRecipients } from './admin-notify';

export interface InquiryInput {
  customerName: string;
  customerEmail?: string | undefined;
  customerPhone: string;
  companyName: string;
  message: string;
  items: Array<{ sku: string; quantity: number }>;
}

export async function createInquiryWithNotification(
  input: InquiryInput,
  opts: { subject?: (who: string, phone10: string) => string } = {},
): Promise<{ inquiryId: number }> {
  const body = input;

  const inquiry = await prisma.inquiry.create({
    data: {
      customerName: body.customerName || null,
      customerEmail: body.customerEmail || null,
      customerPhone: body.customerPhone || null,
      companyName: body.companyName || null,
      message: body.message || null,
      items: body.items as any,
    },
  });

  // Tell the team. This used to go through an SMTP module that is not
  // configured, and was not awaited (Vercel drops un-awaited work), so quote
  // requests arrived with nobody told. Now: Resend — the same sender as the
  // order emails — to the same inboxes, awaited. sendEmail never throws, so
  // a mail hiccup cannot fail the customer's submission.
  try {
    const support = (await prisma.setting.findUnique({ where: { key: 'support_email' } }))?.value;
    const names = await productNames(body.items.map((i) => i.sku));
    const mail = inquiryEmail(body, names, inquiry.id, opts.subject);
    await sendEmail({
      to: adminRecipients([support]),
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      category: 'inquiry',
    });
  } catch (err) {
    console.error('[inquiry] notification failed:', err);
  }

  return { inquiryId: inquiry.id };
}

/** SKU -> "name (₹price)" for parents and variant SKUs, so the email names the product. */
async function productNames(skus: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (skus.length === 0) return out;
  const [parents, variants] = await Promise.all([
    prisma.product.findMany({ where: { sku: { in: skus } }, select: { sku: true, name: true, price: true } }),
    prisma.productVariant.findMany({
      where: { skuSuffix: { in: skus } },
      select: { skuSuffix: true, variantValue: true, price: true, product: { select: { name: true, price: true } } },
    }),
  ]);
  for (const p of parents) out.set(p.sku, `${p.name} (${inr(p.price)})`);
  for (const v of variants) {
    if (!v.skuSuffix) continue;
    const name = v.variantValue ? `${v.product.name} — ${v.variantValue}` : v.product.name;
    out.set(v.skuSuffix, `${name} (${inr(v.price ?? v.product.price)})`);
  }
  return out;
}

const inr = (n: unknown) => '₹' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function inquiryEmail(
  b: InquiryInput,
  names: Map<string, string>,
  id: number,
  subjectFn?: (who: string, phone10: string) => string,
) {
  const phone10 = (b.customerPhone || '').replace(/\D/g, '').slice(-10);
  const who = b.customerName || b.companyName || 'anonymous';
  const subject = subjectFn
    ? subjectFn(who, phone10)
    : `New quote request from ${who}${phone10 ? ` (${phone10})` : ''}`;
  const itemRows = b.items.length
    ? `<h3 style="margin:16px 0 6px">Items</h3><ul>${b.items
        .map((i) => `<li>${escape(names.get(i.sku) || i.sku)} × ${i.quantity} <span style="color:#888">(${escape(i.sku)})</span></li>`)
        .join('')}</ul>`
    : '<p><i>No items listed</i></p>';
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:560px">
    <h2 style="margin:0 0 12px">New quote request</h2>
    <p><b>Name:</b> ${escape(b.customerName)}<br>
    <b>Company:</b> ${escape(b.companyName)}<br>
    <b>Email:</b> ${escape(b.customerEmail || '')}<br>
    <b>Phone:</b> ${phone10 ? `<a href="tel:+91${phone10}">${escape(b.customerPhone)}</a> · <a href="https://wa.me/91${phone10}">WhatsApp</a>` : escape(b.customerPhone)}</p>
    ${itemRows}
    <p><b>Message:</b></p>
    <pre style="white-space:pre-wrap;font-family:inherit;">${escape(b.message)}</pre>
    <p><a href="${adminBaseUrl()}/dashboard/inquiries">Open inquiries in admin</a> (#${id})</p>
    </div>
  `;
  const text = [
    `New quote request from ${who}`,
    `Phone: ${b.customerPhone || '-'} | Email: ${b.customerEmail || '-'} | Company: ${b.companyName || '-'}`,
    ...b.items.map((i) => `- ${names.get(i.sku) || i.sku} x ${i.quantity}`),
    `Message: ${b.message || '-'}`,
    `${adminBaseUrl()}/dashboard/inquiries`,
  ].join('\n');
  return { subject, html, text };
}

function escape(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] as string));
}
