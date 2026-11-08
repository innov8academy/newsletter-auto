import 'server-only';
import { randomUUID } from 'node:crypto';
import { callL8RData, cloudflareSelected, cloudflareConfigured } from './cloudflare-data';
import { supabaseAdmin, isSupabaseConfigured } from './supabase';

type QueryResult<T> = { rows: T[]; changes: number };
type PastNewsletter = { content_text: string; file_name: string; imported_at: string | null };
type NewsRow = { id: string; url: string; title: string; raw_summary: string | null; published_at: string | null; created_at: string; source_id: string | null };
type XCacheInput = { url: string; title: string; raw_summary: string; published_at: string; source_id: string; is_processed: boolean };
const MAX_WORKER_BATCH_STATEMENTS = 100;

export function legacyDataConfigured(): boolean {
  if (cloudflareSelected() && !cloudflareConfigured()) throw new Error('L8R Cloudflare storage is not configured');
  return cloudflareSelected() || isSupabaseConfigured();
}

export async function recentNewsletters(limit = 2): Promise<PastNewsletter[]> {
  if (cloudflareSelected()) {
    const result = await callL8RData<QueryResult<PastNewsletter>>({ op: 'query', sql: 'SELECT content_text, file_name, imported_at FROM past_newsletters ORDER BY imported_at DESC, id DESC LIMIT ?', params: [limit] });
    return result.rows;
  }
  const { data, error } = await supabaseAdmin.from('past_newsletters').select('content_text, file_name, imported_at').order('imported_at', { ascending: false, nullsFirst: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function insertNewsletter(input: { title: string; file_name: string; content_html: string; content_text: string; imported_at: string }): Promise<void> {
  if (cloudflareSelected()) {
    await callL8RData<QueryResult<never>>({ op: 'query', sql: 'INSERT INTO past_newsletters (id,title,file_name,content_html,content_text,imported_at) VALUES (?,?,?,?,?,?)', params: [randomUUID(), input.title, input.file_name, input.content_html, input.content_text, input.imported_at] });
    return;
  }
  const { error } = await supabaseAdmin.from('past_newsletters').insert(input);
  if (error) throw error;
}

export async function usedHeadlines(since: string): Promise<string[]> {
  if (cloudflareSelected()) {
    const result = await callL8RData<QueryResult<{ headline: string }>>({ op: 'query', sql: 'SELECT headline FROM used_stories WHERE used_at >= ? ORDER BY used_at DESC', params: [since] });
    return result.rows.map(row => row.headline);
  }
  const { data, error } = await supabaseAdmin.from('used_stories').select('headline').gte('used_at', since).order('used_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => row.headline);
}

export async function insertUsedStories(stories: { headline: string; url: string | null; used_at: string }[]): Promise<number> {
  if (cloudflareSelected()) {
    if (stories.length > MAX_WORKER_BATCH_STATEMENTS) throw new Error('Too many stories for one atomic save');
    const result = await callL8RData<QueryResult<never>[]>({ op: 'batch', statements: stories.map(story => ({ sql: 'INSERT INTO used_stories (headline,url,used_at) VALUES (?,?,?)', params: [story.headline, story.url, story.used_at] })) });
    return result.reduce((total, item) => total + item.changes, 0);
  }
  const { data, error } = await supabaseAdmin.from('used_stories').insert(stories).select();
  if (error) throw error;
  return data?.length || 0;
}

export async function replaceXCache(sourceId: string, rows: XCacheInput[]): Promise<void> {
  if (cloudflareSelected()) {
    // Keep the delete and every insert in one transaction. The current X pipeline sends at most 20 rows.
    if (rows.length >= MAX_WORKER_BATCH_STATEMENTS) throw new Error('Too many X items for one atomic cache replacement');
    if (rows.some(row => row.source_id !== sourceId)) throw new Error('X cache source mismatch');
    const now = new Date().toISOString();
    await callL8RData<QueryResult<never>[]>({ op: 'batch', statements: [
      { sql: 'DELETE FROM news_items WHERE source_id=?', params: [sourceId] },
      ...rows.map(row => ({ sql: 'INSERT INTO news_items (id,source_id,url,title,raw_summary,published_at,created_at,is_processed) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(url) DO NOTHING', params: [randomUUID(), row.source_id, row.url, row.title, row.raw_summary, row.published_at, now, row.is_processed ? 1 : 0] })),
    ] });
    return;
  }
  await supabaseAdmin.from('news_items').delete().eq('source_id', sourceId);
  const { error } = await supabaseAdmin.from('news_items').upsert(rows, { onConflict: 'url', ignoreDuplicates: true });
  if (error) throw error;
}

export async function cachedXRows(sourceId: string, limit = 20): Promise<NewsRow[]> {
  if (cloudflareSelected()) {
    const result = await callL8RData<QueryResult<NewsRow>>({ op: 'query', sql: 'SELECT * FROM news_items WHERE source_id=? ORDER BY created_at DESC LIMIT ?', params: [sourceId, limit] });
    return result.rows;
  }
  const { data, error } = await supabaseAdmin.from('news_items').select('*').eq('source_id', sourceId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}
