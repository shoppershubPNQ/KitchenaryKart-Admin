import { NextRequest, NextResponse } from 'next/server';

const TOKEN_COOKIE = 'kk_admin_token';

// Edge-safe JWT check: just verify a token *exists* and isn't obviously expired.
// Full signature verification happens in route handlers (where Node runtime is available).
function hasLikelyValidToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.exp && Date.now() / 1000 > payload.exp) return false;
    return true;
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(TOKEN_COOKIE)?.value;
  const authed = token ? hasLikelyValidToken(token) : false;

  if (pathname.startsWith('/dashboard') && !authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (pathname === '/login' && authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login'],
};
