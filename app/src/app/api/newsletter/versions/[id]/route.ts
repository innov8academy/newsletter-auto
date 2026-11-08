import { NextResponse } from 'next/server';
import { callL8RData, cloudflareConfigured, cloudflareSelected } from '@/lib/cloudflare-data';

type Version = { source: string; created_at: string; snapshot: string };
type QueryResult<T> = { rows: T[]; changes: number };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid version.' }, { status: 400 });
  if (cloudflareSelected()) {
    if (!cloudflareConfigured()) return NextResponse.json({ error: 'Cloud history is unavailable.' }, { status: 503 });
    try {
      const state = await callL8RData<{ draft_choices: Array<{ id: string }> }>({ op: 'newsletter_state' });
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const isChoice = (state.draft_choices ?? []).some(choice => choice.id === id);
      const result = await callL8RData<QueryResult<Version>>({ op: 'query',
        sql: `SELECT source,created_at,snapshot FROM newsletter_versions WHERE id=?${isChoice ? '' : ' AND created_at >= ?'}`,
        params: isChoice ? [id] : [id, cutoff] });
      const found = result.rows[0];
      if (!found) return NextResponse.json({ error: 'Version unavailable.' }, { status: 404 });
      const data = { ...found, snapshot: JSON.parse(found.snapshot) };
      return new NextResponse(JSON.stringify(data, null, 2), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    } catch { return NextResponse.json({ error: 'Cloud history is unavailable.' }, { status: 503 }); }
  }
  const { supabaseAdmin } = await import('@/lib/supabase');
  const { data, error } = await supabaseAdmin.from('newsletter_versions').select('source,created_at,snapshot').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: 'Cloud history is unavailable.' }, { status: 503 });
  if (!data) return NextResponse.json({ error: 'Version unavailable.' }, { status: 404 });
  return new NextResponse(JSON.stringify(data, null, 2), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
