import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { fail, handleError, ok } from '@/lib/api';
import { sendEmail } from '@/lib/integrations/email';

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

    // Best-effort notification; failures don't block the public response.
    const support = (await prisma.setting.findUnique({ where: { key: 'support_email' } }))?.value;
    if (support) {
      sendEmail(
        support,
        `New quote request from ${body.customerName || 'anonymous'}`,
        inquiryEmailBody(body)
      ).catch(err => console.error('email error:', err));
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

function inquiryEmailBody(b: z.infer<typeof schema>): string {
  const itemRows = b.items.length
    ? `<h3>Items</h3><ul>${b.items.map(i => `<li>${i.sku} × ${i.quantity}</li>`).join('')}</ul>`
    : '<p><i>No items listed</i></p>';
  return `
    <h2>New quote request</h2>
    <p><b>Name:</b> ${escape(b.customerName)}<br>
    <b>Company:</b> ${escape(b.companyName)}<br>
    <b>Email:</b> ${escape(b.customerEmail || '')}<br>
    <b>Phone:</b> ${escape(b.customerPhone)}</p>
    ${itemRows}
    <p><b>Message:</b></p>
    <pre style="white-space:pre-wrap;font-family:inherit;">${escape(b.message)}</pre>
  `;
}

function escape(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] as string));
}
