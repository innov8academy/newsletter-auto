import { NextResponse } from 'next/server';
import { callL8RData, cloudflareConfigured, cloudflareSelected } from '@/lib/cloudflare-data';

type Version = { id: string; source: string; created_at: string };
type QueryResult<T> = { rows: T[]; changes: number };

export async function GET() {
  if (cloudflareSelected()) {
    if (!cloudflareConfigured()) return NextResponse.json({ error: 'Cloud history is unavailable.' }, { status: 503 });
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const state = await callL8RData<{ draft_choices: Array<{ id: string }> }>({ op: 'newsletter_state' });
      const recent = await callL8RData<QueryResult<Version>>({ op: 'query',
        sql: 'SELECT id,source,created_at FROM newsletter_versions WHERE created_at >= ? ORDER BY created_at DESC', params: [cutoff] });
      const protectedIds = (state.draft_choices ?? []).map(choice => choice.id)
        .filter(id => /^[0-9a-f-]{36}$/i.test(id));
      const protectedRows: Version[] = [];
      for (let offset = 0; offset < protectedIds.length; offset += 100) {
        const ids = protectedIds.slice(offset, offset + 100);
        const result = await callL8RData<QueryResult<Version>>({ op: 'query',
          sql: `SELECT id,source,created_at FROM newsletter_versions WHERE id IN (${ids.map(() => '?').join(',')})`, params: ids });
        protectedRows.push(...result.rows);
      }
      const versions = [...new Map([...recent.rows, ...protectedRows].map(item => [item.id, item])).values()]
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return NextResponse.json({ versions }, { headers: { 'Cache-Control': 'no-store' } });
    } catch { return NextResponse.json({ error: 'Cloud history is unavailable.' }, { status: 503 }); }
  }
  const { supabaseAdmin } = await import('@/lib/supabase');
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
