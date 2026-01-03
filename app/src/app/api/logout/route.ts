import { NextResponse } from 'next/server';

export async function POST() {
    const response = NextResponse.json({ success: true, message: 'Logged out' });

    // Clear the auth cookie by setting maxAge to 0
    response.cookies.set('site-auth', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
    });

    return response;
}
