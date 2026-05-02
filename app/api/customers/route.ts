import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok, paging } from '@/lib/api';

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  companyName: z.string().optional(),
  customerType: z.enum(['retail', 'b2b', 'corporate']).optional(),
  billingAddress: z.string().optional(),
  shippingAddress: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  gstNumber: z.string().optional(),
  creditLimit: z.number().nonnegative().optional(),
});

export const GET = withAuth(async (req) => {
  try {
    const url = new URL(req.url);
    const { limit, offset } = paging(url);
    const type = url.searchParams.get('type') || undefined;
    const source = url.searchParams.get('source') || undefined;
    const search = url.searchParams.get('search')?.trim();

    const where: Prisma.CustomerWhereInput = {};
    if (type) where.customerType = type as any;
    if (source === 'web' || source === 'admin') where.signupSource = source;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { companyName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      prisma.customer.count({ where }),
    ]);

    return ok({ customers, total, limit, offset });
  } catch (e) {
    return handleError(e);
  }
});

export const POST = withAuth(async (req) => {
  try {
    const body = createSchema.parse(await req.json());
    // Records created through this admin endpoint are stamped as 'admin'.
    const customer = await prisma.customer.create({
      data: { ...body, signupSource: 'admin' },
    });
    return ok({ customer }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales']);
