import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET() {
    // Safely check if the key exists on the server without exposing it
    const hasKey = !!process.env.OPENROUTER_API_KEY;
    const hasPassword = !!process.env.SITE_PASSWORD;

    return NextResponse.json({
        configured: hasKey,
        passwordRequired: hasPassword,
    });
}
