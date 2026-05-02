import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

/**
 * Prisma's `Decimal` and `BigInt` values don't JSON.stringify cleanly.
 * Normalise them to strings/numbers before returning.
 */
export function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === 'bigint') return Number(v);
      if (v && typeof v === 'object' && v.constructor?.name === 'Decimal') return Number(v.toString());
      return v;
    })
  );
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(jsonSafe(data) as any, init);
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function handleError(e: unknown): Response {
  if (e instanceof ZodError) {
    return fail(e.errors.map(x => `${x.path.join('.')}: ${x.message}`).join('; '), 400);
  }
  if (e instanceof Error) {
    console.error(e);
    return fail(e.message, 500);
  }
  console.error(e);
  return fail('Internal server error', 500);
}

/** Pagination helper. */
export function paging(url: URL) {
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0'));
  return { limit, offset };
}
