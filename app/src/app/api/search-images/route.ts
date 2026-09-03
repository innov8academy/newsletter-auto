import { NextRequest } from 'next/server';
import { studioRoute } from '@/lib/studio/http';
export const maxDuration = 120;
export async function POST(request: NextRequest) { return studioRoute(request, ['references', 'search']); }
