import { NextRequest } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['admin', 'sales', 'staff', 'accounts']),
  phone: z.string().optional(),
});

export const GET = withAuth(async () => {
  try {
    const users = await prisma.adminUser.findMany({
      select: { id: true, name: true, email: true, role: true, phone: true, isActive: true, lastLogin: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return ok({ users });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);

export const POST = withAuth(async (req) => {
  try {
    const body = createSchema.parse(await req.json());
    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await prisma.adminUser.create({
      data: {
        name: body.name,
        email: body.email,
        passwordHash,
        role: body.role,
        phone: body.phone,
      },
      select: { id: true, name: true, email: true, role: true },
    });
    return ok({ user }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
