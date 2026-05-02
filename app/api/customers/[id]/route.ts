import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';

const patchSchema = z.object({
  name: z.string().optional(),
  phone: z.string().nullable().optional(),
  companyName: z.string().nullable().optional(),
  customerType: z.enum(['retail', 'b2b', 'corporate']).optional(),
  billingAddress: z.string().nullable().optional(),
  shippingAddress: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  gstNumber: z.string().nullable().optional(),
  creditLimit: z.number().nonnegative().optional(),
  creditUsed: z.number().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

export const GET = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, orderNumber: true, orderStatus: true, totalAmount: true, createdAt: true },
        },
      },
    });
    if (!customer) return fail('Not found', 404);
    return ok({ customer });
  } catch (e) {
    return handleError(e);
  }
});

export const PATCH = withAuth(async (req, { params }) => {
  try {
    const id = parseInt(params.id);
    const body = patchSchema.parse(await req.json());
    const customer = await prisma.customer.update({ where: { id }, data: body });
    return ok({ customer });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales']);

export const DELETE = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    await prisma.customer.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
