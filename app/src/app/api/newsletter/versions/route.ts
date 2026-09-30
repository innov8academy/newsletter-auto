import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  const { data, error } = await supabaseAdmin.from('newsletter_versions')
    .select('id,source,created_at').order('created_at', { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: 'Cloud history is unavailable.' }, { status: 503 });
  const archived = await supabaseAdmin.from('newsletter_versions')
    .select('id,source,created_at').in('source', ['new-newsletter', 'legacy-writing', 'legacy-studio'])
    .order('created_at', { ascending: false }).limit(100);
  if (archived.error) return NextResponse.json({ error: 'Cloud history is unavailable.' }, { status: 503 });
  const versions = [...new Map([...(data ?? []), ...(archived.data ?? [])].map(item => [item.id, item])).values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return NextResponse.json({ versions }, { headers: { 'Cache-Control': 'no-store' } });
}
