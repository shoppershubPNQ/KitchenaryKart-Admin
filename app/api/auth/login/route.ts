import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { signToken, TOKEN_COOKIE } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const user = await prisma.adminUser.findUnique({ where: { email: body.email } });
    if (!user || !user.isActive) return fail('Invalid credentials', 401);

    const passOk = await bcrypt.compare(body.password, user.passwordHash);
    if (!passOk) return fail('Invalid credentials', 401);

    await prisma.adminUser.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    const res = ok({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
    res.cookies.set(TOKEN_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24,
    });
    return res;
  } catch (e) {
    return handleError(e);
  }
}
