import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { fail, ok } from '@/lib/api';

export async function GET(req: NextRequest) {
  const user = getSession(req);
  if (!user) return fail('Unauthorized', 401);
  return ok({ user });
}
