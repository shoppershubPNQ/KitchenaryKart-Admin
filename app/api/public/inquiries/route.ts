import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { fail, handleError, ok } from '@/lib/api';
import { sendEmail } from '@/lib/integrations/resend';
import { adminBaseUrl, adminRecipients } from '@/lib/admin-notify';

const schema = z.object({
  customerName: z.string().optional().default(''),
  customerEmail: z.string().email().optional().or(z.literal('')),
  customerPhone: z.string().optional().default(''),
  companyName: z.string().optional().default(''),
  message: z.string().optional().default(''),
  items: z.array(z.object({ sku: z.string(), quantity: z.number().int().positive() })).optional().default([]),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());

    if (!body.customerName && !body.customerEmail && !body.customerPhone) {
      return fail('Please provide at least a name, email or phone', 400);
    }

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
      const mail = inquiryEmail(body, names, inquiry.id);
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

    return ok({ inquiryId: inquiry.id }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
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

function inquiryEmail(b: z.infer<typeof schema>, names: Map<string, string>, id: number) {
  const phone10 = (b.customerPhone || '').replace(/\D/g, '').slice(-10);
  const who = b.customerName || b.companyName || 'anonymous';
  const subject = `New quote request from ${who}${phone10 ? ` (${phone10})` : ''}`;
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
