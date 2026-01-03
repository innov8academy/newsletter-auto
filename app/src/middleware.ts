import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const sitePassword = process.env.SITE_PASSWORD;

    // If no password is set, allow all requests
    if (!sitePassword) {
        return NextResponse.next();
    }

    const { pathname } = request.nextUrl;

    // Allow these paths without auth
    const publicPaths = [
        '/login',
        '/api/auth',
        '/api/logout',
        '/api/status',
        '/_next',
        '/favicon.ico',
        '/logo.jpg',
    ];

    // Check if path starts with any public path
    const isPublicPath = publicPaths.some(path => pathname.startsWith(path));
    if (isPublicPath) {
        return NextResponse.next();
    }

    // Allow static files
    if (pathname.includes('.')) {
        return NextResponse.next();
    }

    // Check for auth cookie
    const authCookie = request.cookies.get('site-auth');
    if (authCookie?.value === 'authenticated') {
        return NextResponse.next();
    }

    // Redirect to login if not authenticated
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
}

export const config = {
    matcher: [
        /*
         * Match all request paths except:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
};
