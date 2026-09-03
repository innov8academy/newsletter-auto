import { NextRequest, NextResponse } from 'next/server';
import { correctPassword, createSession, localDevelopment, sameRequestOrigin, SESSION_COOKIE, sessionConfigured } from '@/lib/site-session';

export async function POST(request: NextRequest) {
    const origin = request.headers.get('origin');
    if (!sameRequestOrigin(origin, request.url, request.headers.get('host'))) return NextResponse.json({ success: false, error: 'Invalid request origin.' }, { status: 403 });
    if (localDevelopment()) return NextResponse.json({ success: true });
    if (!sessionConfigured()) return NextResponse.json({ success: false, error: 'Site sign-in is not configured on the server.' }, { status: 503 });
    try {
        const { password } = await request.json();
        if (typeof password !== 'string' || password.length > 1024 || !await correctPassword(password, process.env.SITE_PASSWORD!)) return NextResponse.json({ success: false, error: 'Incorrect password.' }, { status: 401 });
        const response = NextResponse.json({ success: true });
        response.cookies.set(SESSION_COOKIE, await createSession(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 24 * 7, path: '/' });
        return response;
    } catch { return NextResponse.json({ success: false, error: 'Could not sign in.' }, { status: 400 }); }
}
