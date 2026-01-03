import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET() {
    // Safely check if the key exists on the server without exposing it
    const hasKey = !!process.env.OPENROUTER_API_KEY;

    return NextResponse.json({
        configured: hasKey
    });
}
