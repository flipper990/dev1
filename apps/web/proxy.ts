import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_ROUTES = new Set([
  '/',
  '/product',
  '/pricing',
  '/how-it-works',
  '/request-demo',
  '/waitlist',
  '/enterprise',
  '/docs',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/accept-invite',
]);

const PROTECTED_PREFIXES = [
  '/overview',
  '/projects',
  '/workspace',
  '/workspaces',
  '/agents',
  '/billing',
  '/settings',
  '/security',
  '/deployments',
  '/onboarding',
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_ROUTES.has(pathname)) return true;
  if (pathname.startsWith('/docs/')) return true;
  return false;
}

function requiresAuth(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function hasSessionCookies(request: NextRequest): boolean {
  return Boolean(
    request.cookies.get('devteam_access_token')?.value
    || request.cookies.get('devteam_refresh_token')?.value
    || request.cookies.get('devteam_auth_token')?.value,
  );
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname === '/favicon.ico') {
    return NextResponse.next();
  }

  const authenticated = hasSessionCookies(request);
  const authPages = new Set(['/login', '/signup', '/forgot-password', '/reset-password']);

  if (requiresAuth(pathname) && !authenticated) {
    const redirectUrl = new URL('/login', request.url);
    const nextPath = `${pathname}${search}`;
    redirectUrl.searchParams.set('next', nextPath);
    return NextResponse.redirect(redirectUrl);
  }

  if (authenticated && authPages.has(pathname)) {
    return NextResponse.redirect(new URL('/overview', request.url));
  }

  if (!isPublic(pathname) && !requiresAuth(pathname)) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
