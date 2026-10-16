import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fail, handleError, ok } from '@/lib/api';
import { createInquiryWithNotification } from '@/lib/inquiry-create';

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

    // Row + team notification live in lib/inquiry-create.ts (shared with the
    // website chatbot's save_lead). Behaviour, email and response unchanged.
    const { inquiryId } = await createInquiryWithNotification(body);

    return ok({ inquiryId }, { status: 201 });
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
