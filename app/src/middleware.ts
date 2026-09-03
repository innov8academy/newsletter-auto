import { NextResponse, type NextRequest } from 'next/server';
import { localDevelopment, verifySession, SESSION_COOKIE } from './lib/site-session';

export async function middleware(request: NextRequest) {
    const pathname = request.nextUrl.pathname;
    const publicPaths = ['/login', '/api/auth', '/api/logout', '/api/status', '/_next/', '/favicon.ico', '/logo.jpg'];
    // Preserve the existing public site mode. Studio APIs independently require
    // signed sessions in production, including when site auth is not configured.
    if (publicPaths.some(path => pathname === path || (path.endsWith('/') && pathname.startsWith(path))) || localDevelopment() || !process.env.SITE_PASSWORD) return NextResponse.next();
    if (await verifySession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
    if (pathname.startsWith('/api/')) return NextResponse.json({ success: false, error: 'Sign in again to continue.', code: 'unauthenticated' }, { status: 401 });
    return NextResponse.redirect(new URL('/login', request.url));
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
