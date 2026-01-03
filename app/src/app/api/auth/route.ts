import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    const sitePassword = process.env.SITE_PASSWORD;

    // If no password is set, just authenticate
    if (!sitePassword) {
        const response = NextResponse.json({ success: true, message: 'No password required' });
        response.cookies.set('site-auth', 'authenticated', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7, // 7 days
            path: '/',
        });
        return response;
    }

    try {
        const body = await request.json();
        const { password } = body;

        if (!password) {
            return NextResponse.json(
                { success: false, error: 'Password is required' },
                { status: 400 }
            );
        }

        if (password !== sitePassword) {
            return NextResponse.json(
                { success: false, error: 'Incorrect password' },
                { status: 401 }
            );
        }

        // Set auth cookie
        const response = NextResponse.json({ success: true, message: 'Authenticated' });
        response.cookies.set('site-auth', 'authenticated', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7, // 7 days
            path: '/',
        });

        return response;
    } catch (error) {
        console.error('Auth error:', error);
        return NextResponse.json(
            { success: false, error: 'Authentication failed' },
            { status: 500 }
        );
    }
}
