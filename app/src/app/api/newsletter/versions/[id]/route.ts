import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid version.' }, { status: 400 });
  const { data, error } = await supabaseAdmin.from('newsletter_versions').select('source,created_at,snapshot').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: 'Cloud history is unavailable.' }, { status: 503 });
  if (!data) return NextResponse.json({ error: 'Version unavailable.' }, { status: 404 });
  return new NextResponse(JSON.stringify(data, null, 2), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
