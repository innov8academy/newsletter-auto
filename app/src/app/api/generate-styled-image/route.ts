import { NextRequest } from 'next/server';
import { studioRoute } from '@/lib/studio/http';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(request: NextRequest) { return studioRoute(request, ['generations']); }
