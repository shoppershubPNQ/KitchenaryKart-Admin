import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { AdminRole } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
export const TOKEN_COOKIE = 'kk_admin_token';
const TOKEN_TTL = '24h';

export interface SessionUser {
  id: number;
  email: string;
  role: AdminRole;
  name: string;
}

export function signToken(user: SessionUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): SessionUser | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    return {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      name: decoded.name,
    };
  } catch {
    return null;
  }
}

/** Read session from the request cookie or Authorization header. */
export function getSession(req: NextRequest): SessionUser | null {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const u = verifyToken(auth.slice(7));
    if (u) return u;
  }
  const token = req.cookies.get(TOKEN_COOKIE)?.value;
  return token ? verifyToken(token) : null;
}

/** Server-component helper. */
export function getServerSession(): SessionUser | null {
  const token = cookies().get(TOKEN_COOKIE)?.value;
  return token ? verifyToken(token) : null;
}

/** Wrap a route handler; rejects with 401/403 if the user isn't authorised. */
export function withAuth(
  handler: (req: NextRequest, ctx: { user: SessionUser; params: any }) => Promise<Response> | Response,
  allowed?: AdminRole[]
) {
  return async (req: NextRequest, ctx: { params: any }) => {
    const user = getSession(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (allowed && !allowed.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return handler(req, { user, params: ctx.params });
  };
}
